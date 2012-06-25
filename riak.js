/*global exports require */

var http = require("http"),
    events = require("events"),
    inspect = require("util").inspect,
    querystring = require("querystring"),
    LB_Pool = require("poolee");

// helper function for metrics and logging
function path_root(path) {
    var parts = path.split('/');
    if (parts[1] === 'solr') {
        return 'solr';
    }
    else if (parts[0] === 'mapred') {
        return 'mapred';
    }
    else {
        return parts[2];
    }
}

// RiakClient manages the lb_pool and sets the lb retry filter.  It also owns the riak client_id
// New requests are RiakRequest objects which support optional sibling resolution
function RiakClient(node_list, client_id, pool_name) {
    events.EventEmitter.call(this);

    var self = this;
    this.client_id = client_id;

    if (!pool_name) {
        pool_name = "riak_user";
    }

    if (! this.client_id) {
        throw new Error("client_id must be specified");
    }

    this.pool = new LB_Pool(http, node_list, {
        retry_filter: this.retry_filter.bind(this),
        check_interval: 10000,
        name: pool_name
    });

    this.pool.on('timing', function (duration, request_options) {
        if (request_options.success) {
            self.histogram("LB_Pool_" + pool_name + "|" + request_options.method + "|" + path_root(request_options.path), duration);
            if (duration > 300) {
                self.log("timing_stats", request_options.host + request_options.path + " took " + duration + "ms");
            }
        } else {
            self.histogram("LB_fail_" + pool_name + "|" + request_options.method + "|" + path_root(request_options.path), duration);
            self.log("riak error", request_options.host + request_options.path + " took " + duration + "ms");
        }
    });

    this.pool.on('health', function (stat) {
        self.log("riak pool health", stat);
        self.counter("riak_pool_health_change", 1);
    });

    this.pool.on('retrying', function (err) {
        var path = path_root(err.attempt.options.path);
        if (err.reason !== 'filter') {
            self.warn("riak retry", "path: " + path + " reason: " + err.message);
        }
        self.counter("riak_retry_path|" + path, 1);
        self.counter("riak_retry_reason|" + err.reason.replace(/\W/g, '_'), 1);
    });

    this.debug_mode = false;
    
}
require("util").inherits(RiakClient, events.EventEmitter);

RiakClient.prototype.log = function (op, str) {
    console.log(op + " " + str);
};

RiakClient.prototype.warn = function (op, str) {
    console.error(op + " " + str);
};

RiakClient.prototype.error = function (op, str) {
    console.error(op + " " + str);
};

RiakClient.prototype.histogram = function (key, val) {
    this.emit("metrics", "histogram", key, val);
};

RiakClient.prototype.counter = function (key, val) {
    this.emit("metrics", "counter", key, val);
};

RiakClient.prototype.fmt_bk = function (bucket, key) {
    return 'bucket_key="' + bucket + "/" + key + '"';
};

// TODO - this retry filter is not generic. We need some sensible defaults.
RiakClient.prototype.retry_filter = function retry_filter(options, response, body) {
    var log_str = options.host + ":" + options.port + options.path;

    if (response.statusCode === 500) {
        this.warn("riak retry", log_str + " retrying on 500 status: " + body);
        this.counter("riak_retry_filter|500", 1);
        return true;
    }

    // this works around a Riak restart condition where a precommit hook fails while the node is initializing.
    if (options.method === "PUT" && response.statusCode === 403) {
        this.warn("riak retry", log_str + " retrying PUT on 403 status");
        this.counter("riak_retry_filter|403_PUT", 1);
        return true;
    }

    if (options.retry_not_found && options.method === "GET" && response.statusCode === 404) {
        if (!options.notFound) {
            options.notFound = 0;
        }
        options.notFound++;
        if (options.notFound < 2) { // TODO make retry count an option
            this.counter("riak_retry_filter|404_GET", 1);
            return true;
        }
        // TODO - need an option to decide whether to log this.  Sometimes 404's are expected, but you still want retry, like for bodies
        // log("riak retry", log_str + " giving up on 404");
        return false;
    }

    // on a previous request we got a 404, now we got something else, celebrate
    if (options.notFound) {
        this.counter("riak_retry_recover|" + path_root(options.path), 1);
    }

    return false;
};

RiakClient.prototype.headers = function (new_headers) {
    var out_obj = {
        "X-Riak-ClientId": this.client_id,
        "Connection": "keep-alive"
    }, i, keys;

    if (new_headers) {
        keys = Object.keys(new_headers);
        for (i = 0; i < keys.length ; i++) {
            out_obj[keys[i]] = new_headers[keys[i]];
        }
    }

    return out_obj;
};

function parse_multipart(res, str) {
    var parts, boundary, boundary_escaped, boundary_re, ct_header = res.headers["content-type"],
        fuzzy_crlf = /\r?\n/, fuzzy_crlf2 = /\r?\n\r?\n/, siblings = [];

    // from RFC 1341 - http://www.w3.org/Protocols/rfc1341/7_2_Multipart.html
    // DIGIT / ALPHA / "'" / "(" / ")" / "+"  / "_"  / "," / "-" / "." / "/" / ":" / "=" / "?"
    parts = ct_header.match(/boundary=([\w\'()+,-.\/:=?]+)/);

    if (! parts) {
        return new Error("Couldn't find multipart boundary from: " + ct_header);
    }

    boundary = parts[1];
    boundary_escaped = boundary.replace(/[().,?\/+:=]/g, "\\$&");
    boundary_re = new RegExp("\r?\n--" + boundary_escaped + "-{0,2}\r?\n");

    parts = str.split(boundary_re);
    if (! parts) {
        return new Error("multipart message doesn't split properly: " + str);
    }

    parts.forEach(function (part, i) {
        if (part.length < 2) {
            return;
        }
        var sub_parts = part.split(fuzzy_crlf2), header_part, body_part, headers = {};
        header_part = sub_parts[0];
        body_part = sub_parts[1];

        sub_parts = header_part.split(fuzzy_crlf);
        sub_parts.forEach(function (header_line) {
            var parts = header_line.split(": ");
            headers[parts[0].toLowerCase()] = parts[1];
        });

        siblings.push([headers, body_part]);
    });

    return siblings;
}

// Supported options and their default values
// {
//     r_val: <number> // default is whatever Riak's default is, usually basic quorum
//     w_val: <number> // default is whatever Riak's default is, usually basic quorum
//     retry: <bool>   // default = true, will retry gets with exponential backoff when recieving a 404
//     parse: <bool>   // default = true, will parse riak response assuming it is json
//     resolver: <fn>  // no default = used to resolve sibling values
// }
function RiakRequest(client, bucket, key, options, callback) {
    var self = this;

    this.client = client;
    this.bucket = bucket;
    this.key = key;
    this.options = options || {};
    this.callback_fn = callback;
    this.method = this.options.method;
    this.r_val = this.options.r_val || null;
    this.w_val = this.options.w_val || null;
    this.return_body = this.options.return_body || null;
    this.should_parse = this.options.parse !== false;
    this.should_retry = this.options.retry !== false;
    this.resolver = this.options.resolver || null;
    this.debug_mode = this.client.debug_mode;
    this.vclock = null;
    this.bk_str = client.fmt_bk(bucket, key);

    if (typeof this.callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    if (this.resolver && typeof this.resolver !== "function") {
        throw new Error("options.resolver must be a function, not " + this.resolver);
    }

    if (typeof this.client.pool[this.method] !== "function") {
        throw new Error("options.method: " + options.method + " is not supported by lb_pool client");
    }

    if (this.debug_mode) {
        this.client.log("riak request", this.method + " " + this.bk_str + " options: " + JSON.stringify(this.options));
    }

    if (this.options.body && this.should_parse) {
        this.options.body = JSON.stringify(this.options.body);
    }

    this.do_request();
}

// wrapper for main callback to make sure it only gets called once
RiakRequest.prototype.callback = function (err, res, obj) {
    if (this.callback_called) {
        this.client.warn("riak callback dup", "already called callback for " + this.bk_str);
    } else {
        this.callback_called = true;
        this.callback_fn(err, res, obj);
    }
};

RiakRequest.prototype.do_request = function () {
    var self = this, qobj, qs = "", pool_options;

    if (this.r_val || this.w_val || this.return_body) {
        qobj = {};
        if (this.r_val) {
            qobj.r = this.r_val;
        }
        if (this.w_val) {
            qobj.w = this.w_val;
        }
        if (this.return_body) {
            qobj.returnbody = this.return_body;
        }
        qs = "?" + querystring.stringify(qobj);
    }

    function on_response(err, res, body) {
        self.on_response(err, res, body);
    }

    pool_options = {
        path: "/riak/" + encodeURIComponent(this.bucket) + "/" + encodeURIComponent(this.key) + qs,
        headers: this.client.headers(this.options.http_headers),
        retry_not_found: this.should_retry
    };

    if (this.debug_mode) {
        this.client.log("riak request", "pool options: " + JSON.stringify(pool_options));
    }

    if (this.options.body) {
        this.client.pool[this.method](pool_options, this.options.body, on_response);
    } else {
        this.client.pool[this.method](pool_options, on_response);
    }
};

RiakRequest.prototype.handle_resolved = function (new_value, new_headers, should_save) {
    if (! new_value) {
        return this.callback(new Error("Unable to resolve sibling values"), null, null);
    }

    var out_body, self = this, pool_options;

    // We need to build up at least the headers portion of this for GET and PUT, because client might be doing a GET in order to PUT
    pool_options = {
        path: "/riak/" + encodeURIComponent(this.bucket) + "/" + encodeURIComponent(this.key) + "?returnbody=true",
        headers: this.client.headers(new_headers),
        retry_not_found: this.should_retry
    };

    pool_options.headers["X-Riak-Vclock"] = this.vclock;

    if (should_save) {
        this.client.log("riak resolve siblings save", this.bk_str + " with vclock " + this.vclock + ", headers: " + JSON.stringify(pool_options.headers));

        if (this.should_parse) {
            out_body = JSON.stringify(new_value);
        } else {
            out_body = new_value;
        }

        this.client.pool.put(pool_options, out_body, function (err, res, obj) {
            this.client.log("riak resolve more", "after resolving " + this.bk_str + " we got response " + (err || res.statusCode));
        });
    } else {
        this.client.log("riak resolve siblings skip", this.bk_str);
    }

    pool_options.headers["x-riak-vclock"] = this.vclock; // TODO - hide my shame
    return this.callback(null, { statusCode: 200, headers: pool_options.headers }, new_value); // Danny's favorite: fake HTTP response
};

RiakRequest.prototype.on_response = function (err, res, body) {
    var self = this, obj, pos;

    if (err) {
        this.client.error("riak response error", err.message + ", " + this.method + " " + this.bk_str);
        return this.callback(err);
    }

    if (res.statusCode === 304) {
        return this.callback(null, res, body);
    }

    if (body.length === 0) {
        if (this.debug_mode) {
            this.client.log("riak req empty", this.bk_str + " statusCode: " + res.statusCode + " " + JSON.stringify(this.options));
        }
        return this.callback(null, res, {error: "empty body: " + body});
    }

    if (res.statusCode === 300) {
        if (!this.resolver) {
            return this.callback(new Error("need options.resolver function to resolve sibling values"), null, null);
        }
        this.client.log("riak req siblings", "got siblings for " + this.method + " " + this.bk_str);

        return this.on_sibling_response(err, res, body);
    }

    if (this.should_parse) {
        if (res.statusCode !== 200) { // Riak errors are just text, so we make an Object out of them
            body = {body: body, statusCode: res.statusCode};
        } else {
            try {
                obj = JSON.parse(body);
            } catch (json_err) {
                this.client.error("riak req", "Error parsing response body from " + this.bk_str + ", options " + JSON.stringify(this.options) + ", body: " + body);
                return this.callback(new Error("JSON parse error"), null, null);
            }
        }
    } else {
        obj = body;
    }

    return this.callback(null, res, obj);
};

RiakRequest.prototype.on_sibling_response = function (err, res, body) {
    var bodies, pos, self = this;

    if (err) {
        this.client.error("siblings get error", inspect(err));
        return this.callback(err);
    }

    if (! res.headers["content-type"].match(/^multipart\/mixed/)) {
        this.client.error("siblings missing", "sibling response is not multipart for " + this.method + " " + this.bk_str);
        return this.callback(new Error("sibling re-fecth did not get back multipart response"));
    }

    bodies = parse_multipart(res, body);
    if (bodies instanceof Error) {
        return this.callback(bodies, null, null);
    }
    if (bodies.length <= 1) {
        this.client.error("riak get siblings", "didn't get multiple sibling values from multipart response for " + this.bk_str + ": " + body);
    }

    if (this.should_parse) {
        for (pos = 0; pos < bodies.length; pos++) {
            try {
                bodies[pos][1] = JSON.parse(bodies[pos][1]);
            } catch (json_err) {
                this.client.error("riak get", "Error parsing response str: " + this.bk_str + ", options " + JSON.stringify(this.options) + ", body: " +
                    JSON.stringify(bodies[pos][1]));
                return this.callback(new Error("JSON parse error"), null, null);
            }
        }
    }

    this.vclock = res.headers["x-riak-vclock"];
    self.resolver(bodies, function (new_value, new_headers, should_save) {
        self.handle_resolved(new_value, new_headers, should_save);
    });
    return;
};

RiakClient.prototype.get = function (bucket, key, options, callback) {
    options.method = "get";
    return new RiakRequest(this, bucket, key, options, callback);
};


// options let caller specify http headers that riak may care about such as X-Riak-Vclock and Content-Type
// caller can also specify return_body = true which will return the body and a status code of 200 instead of 204
// Content-Type is assumed to be application/json by default and will be stored as stringified json unless otherwise specified
// example options:
// options {
//     http_headers: {}, (default {})
//     mime_types: expected list of content-types
//     return_body: <bool> (default false)
// }

RiakClient.prototype.put = function (bucket, key, message, options, callback) {
    var http_headers = this.headers(options.http_headers),
        out_body;

    http_headers["Content-Type"] = http_headers["Content-Type"] || "application/json";
    options.http_headers = http_headers;
    options.method = "put";
    options.body = message;

    return new RiakRequest(this, bucket, key, options, callback);
};

RiakClient.prototype.modify = function (bucket, key, mutator, options, callback) {
    if (this.debug_mode) {
        this.log("riak modify", this.fmt_bk(bucket, key));
    }

    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    var self = this;

    // TODO - move this anonymous function nest to the prototype for great GC justice
    this.get(bucket, key, options, function on_get_for_modify(err1, res1, obj) {
        if (err1) {
            return callback(err1);
        }

        function on_mutate(new_obj, new_headers) {
            if (! new_obj) {
                if (self.debug_mode) {
                    self.log("riak modify no change", self.fmt_bk(bucket, key));
                }

                return callback(null, { statusCode: 204 }, obj);
            }

            new_headers = new_headers || {};
            if (res1.statusCode === 200) {
                new_headers["X-Riak-Vclock"] = res1.headers["x-riak-vclock"];
            }

            options.http_headers = new_headers;

            self.put(bucket, key, new_obj, options, function (err, res, obj) {
                if (err) {
                    return callback(err);
                }
                if (res.statusCode !== 204) {
                    return callback(new Error("Internal server error " + res.statusCode));
                }

                callback(null, res, new_obj);
            });
        }

        var new_obj, new_headers = {};

        if (res1.statusCode === 404) {
            return mutator(null, on_mutate);
        }

        if (res1.statusCode === 200) {
            return mutator(obj, on_mutate);
        }

        self.warn("riak modify error", "statusCode " + res1.statusCode);
        return callback(new Error("Server Error, please try again later."));
    });
};

RiakClient.prototype.replace = function (bucket, key, new_val, options, callback) {
    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    function mutator(obj, mod_done) {
        mod_done(new_val, options.http_headers);
    }

    if (this.debug_mode) {
        this.log("riak replace", this.fmt_bk(bucket, key) + " = " + inspect(new_val));
    }

    this.modify(bucket, key, mutator, options, callback);
};

RiakClient.prototype.append = function (bucket, key, new_val, options, callback) {
    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    var self = this;

    function mutator(obj, mod_done) {
        if (! obj) {
            obj = [];
        } else if (! Array.isArray(obj)) {
            self.error("riak append err", "got non-array value to append: " + inspect(obj));
            return callback(new Error("internal database error"));
        }
        if (obj.indexOf(new_val) === -1) {
            obj.push(new_val);
            if (self.debug_mode) {
                self.log("riak append", self.fmt_bk(bucket, key) + " appending " + inspect(obj));
            }
        } else {
            if (self.debug_mode) {
                self.log("riak append dup", self.fmt_bk(bucket, key) + " already have value " + new_val);
            }
            return mod_done();
        }

        mod_done(obj);
    }

    if (this.debug_mode) {
        this.log("riak append", this.fmt_bk(bucket, key) + " += " + new_val);
    }
    this.modify(bucket, key, mutator, options, callback);
};

RiakClient.prototype.del = function (bucket, key, callback) {
    if (this.debug_mode) {
        this.log("riak del", this.fmt_bk(bucket, key));
    }

    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    var self = this;

    this.pool.del({
        path: "/riak/" + encodeURIComponent(bucket) + "/" + encodeURIComponent(key),
        headers: {
            "X-Riak-ClientId": this.client_id,
            "Connection": "close"   // Riak and node have a keepalive-related bug around HTTP DELETE
        }
    }, callback);
};

RiakClient.prototype.post = function (url, post_body, callback) {
    if (this.debug_mode) {
        this.log("riak post", url + ", " + post_body);
    }

    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    var self = this;

    this.pool.post({
        path: url,
        headers: {
            "X-Riak-ClientId": this.client_id,
            "Connection": "keep-alive",
            "Content-Type": "application/json"
        }
    }, post_body, function (err, res, body) {
        var obj = {};
        if (err) {
            self.error("riak post err", inspect(err) + " url: " + url + " post_body: " + post_body);
            return callback(err);
        }
        if (body.length > 0 && res.statusCode === 200) { // TODO - check the content-type header to see if this is actually JSON
            try {
                obj = JSON.parse(body);
            } catch (json_err) {
                self.warn("riak post JSON err", body);
                return callback(new Error("JSON parse error"));
            }
            return callback(null, res, obj);
        } else {
            self.warn("riak post", url + " non-200 statusCode: " + res.statusCode + ", body: " + body + ", post_body: " + post_body);
            return callback(null, res, {error: "non-JSON: " + body});
        }
        callback(null, res, obj);
    });
};

// TODO - this is not longer used, so it might not work anymore.
RiakClient.prototype.solr = function (bucket, query, limit, callback) {
    var self = this;

    limit = limit || 10; // the default limit is 10 so we will respect it

    if (this.debug_mode) {
        this.log("riak solr", bucket + ", " + query);
    }

    if (typeof callback !== "function") {
        throw new Error("Callback passed non-function");
    }

    this.pool.get({
        path: "/solr/" + encodeURIComponent(bucket) +  "/select?q=" + encodeURIComponent(query) + "&wt=json&rows=" + limit,
        headers: {
            "X-Riak-ClientId": this.client_id,
            "Connection": "keep-alive"
        }
    }, function (err, res, body) {
        if (err) {
            return callback(err);
        }
        var obj = {};
        if (body.length > 0 && res.statusCode === 200) {
            try {
                obj = JSON.parse(body).response;
            } catch (json_err) {
                console.warn("riak solr JSON parse: " + body);
                return callback(new Error("JSON parse error"));
            }
            return callback(null, res, obj);
        } else {
            if (self.debug_mode) {
                self.log("riak solr", bucket + ", " + query + " returned non-JSON, statusCode: " + res.statusCode + ", body:" + JSON.stringify(body));
            }
            return callback(null, res, {error: "non-JSON: " + body});
        }
    });
};

module.exports = RiakClient;
