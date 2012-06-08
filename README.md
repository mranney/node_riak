Riak - a node.js riak client
===

This is the client that we use at Voxer.  It's been tested very thoroughly in
our environment and for our usage patterns, but there may be glaring holes in
functionality that we don't use.

It uses the [poolee](https://github.com/dannycoates/poolee) module to do load
balancing and failure detection so you don't necessarily need a load balancer
between node and Riak.

## Example

Try running the example and you should see something like this:

    ranney-imac:~/work/node_riak (master)$ curl -X DELETE localhost:8098/riak/bucket_1/key_1
    ranney-imac:~/work/node_riak (master)$ node example.js 
    metric: counter, riak_retry_filter|404_GET=1
    metric: histogram, LB_Pool_pool_name|GET|bucket_1=51
    metric: histogram, LB_Pool_pool_name|PUT|bucket_1=7
    204:  { counter: 1 }
    ranney-imac:~/work/node_riak (master)$ node example.js 
    metric: histogram, LB_Pool_pool_name|GET|bucket_1=9
    metric: histogram, LB_Pool_pool_name|PUT|bucket_1=5
    204:  { counter: 2 }
    ranney-imac:~/work/node_riak (master)$ node example.js 
    metric: histogram, LB_Pool_pool_name|GET|bucket_1=9
    metric: histogram, LB_Pool_pool_name|PUT|bucket_1=4
    204:  { counter: 3 }

---

These docs are a work in progress. May not be 100% complete.

---

## Create a client

```js
var RiakClient = require("riak");

// list of riak servers you'd like to load balance over (poolee handles this).
var servers = ["127.0.0.1:8098"]

// should be unique, used by riak if you don't supply a vector clock
var client_id = "docs-client"

// informative name for logging purposes etc
var pool_name = "docs-pool"

var client = new RiakClient(servers, client_id, pool_name);
```

From here on we will refer to `client` as an instance of RiakClient.

### Enable debug mode
```js
// shows an activity trace.
client.debug_mode = false;
```

### Events emitted by `client`
TODO: more info on how this is collected and what it means, and what types of
metrics are collected.

```js
client.on("metrics", function (type, key, val) {
    // `type` is either "histogram" or "counter". 
    // Information is gleaned from requests made by poolee, and tells you about
    // downed nodes, retries, and request duration.
    console.log("metric: " + type + ", " + key + "=" + val);
});
```

### client.get(bucket, key, options, callback)

`callback`: mandatory callback function, invoked ala `callback(error, response, object)`

`options`: let caller specify http headers that riak may care about such as 
X-Riak-Vclock and Content-Type.

When `options.return_body = true`, it which will return the body and a status
code of 200 instead of 204.

Content-Type is assumed to be application/json by default and will be stored as
stringified json unless otherwise specified.

The default `options` are

```js
var options = {
    http_headers: {}, 
    mime_types: [], // list of content-types. TODO: never referenced in the code?
    return_body: false
}
client.get(bucket, key, options, callback)
```

### client.replace(bucket, key, new_val, options, callback)

### client.modify(bucket, key, mutator, options, callback) 
This mutator function does a simple increment of prop2 with no error checking.
It does a GET and then a PUT with your modifications.

```js
client.modify("bucket_1", "key_1", function mutator(old, done) {
    var newobj = old || {};
    newobj.counter = newobj.counter || 0;
    newobj.counter++;
    done(newobj);
}, {}, function (err, res, obj) {
    console.error(res.statusCode + ": ", obj);
    process.exit();
});
```

### client.append(bucket, key, new_val, options, callback)

The value stored at `key` must be an array. Attempts to append `new_val` to the
end of the array. If `new_val` is already in the array, it will not be added
again.

Internally it uses `client.modify` with a mutator function to accomplish this.

### client.del(bucket, key, callback)

### client.post(url, post_body, callback)

---

## Semi-deprecated / not in use / possibly not working
### client.solr(bucket, query, limit, callback)
Make a request to riak with a url of the form
    
    /solr/<bucket>/select?q=<query>&wt=json&rows=<limit>

## LICENSE - "MIT License"

Copyright (c) 2012 Matthew Ranney, http://ranney.com/

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.