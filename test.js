var specify = require("specify"),
    filters = process.argv.slice(2),
    RiakClient = require("./"),
    client;

client = new RiakClient(["127.0.0.1:8098"], "client_id", "pool_name");

// turn this on to see an activity trace
client.debug_mode = false;

client.on("metrics", function (type, key, val) {
    console.log("\tmetric: " + type + ", " + key + "=" + val);
});

client.on("error", function (err) {
    console.error(new Error(err.message).stack);
    process.exit(0);
});

specify("put", function (assert) {
    var bucket = "bucket_1",
        key = "key_0",
        message = "some string full of juicy data",
        options = {};

    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);
    });
});
specify("returnbody", function (assert) {
    var bucket = "bucket_1",
        key = "key_1",
        message = "some string full of juicy data",
        options = { return_body: true };

    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 200);
    });
});

specify("get", function (assert) {
    var bucket = "bucket_1",
        key = "key_2",
        message = "blah blah blah blah riak is cool blah blah",
        options = {};

    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);

        client.get(bucket, key, options, callback);
    });
    function callback(err, res, obj) {
        assert.ok(!err);
        assert.equal(obj, message);
        assert.equal(res.statusCode, 200);
    }
});

specify("modify", function (assert) {
    var bucket = "bucket_1",
        key = "key_3",
        message = { counter: 0 },
        options = {};

    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);

        // GET + PUT as modify()
        // This mutator function does a simple increment of obj.counter
        // with no error checking.
        client.modify(bucket, key, mutator, options, callback);

    });
    function mutator(old, done) {
        var newobj = old || {};
        newobj.counter = newobj.counter || 0;
        newobj.counter++;
        done(newobj);
    }
    function callback(err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);
        assert.equal(obj.counter, 1);
    }
});

specify("replace", function (assert) {
    var bucket = "bucket_1",
        key = "key_4",
        message = "OLD VAL",
        new_val = "NEW VAL",
        options = {};
    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);

        client.replace(bucket, key, new_val, options, callback);
    });
    function callback(err, res, obj1) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);
        assert.equal(obj1, new_val);

        client.get(bucket, key, options, function (err, res, obj2) {
            assert.equal(obj2, new_val);
        });
    }
});

specify("append", function (assert) {
    var bucket = "bucket_1",
        key = "key_5",
        message = [ 1, 2, 3, 4 ],
        new_val = 5,
        options = {};
    client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);

        client.append(bucket, key, new_val, options, function (err, res, obj) {
            assert.ok(!err);
            assert.equal(res.statusCode, 204);

            client.get(bucket, key, options, function (err, res, obj2) {
                assert.ok(!err);
                assert.equal(res.statusCode, 200);
                assert.deepEqual(obj, [1, 2, 3, 4, 5]);
            });
        });
    });
});

specify("index", function (assert) {
    var bucket = "bucket_1",
        key = "key_6",
        message = "some string full of juicy data",
		options = {"http_headers": {"x-riak-index-id_int": "1"}},
		index = "id_int",
		begin_val = "1",
		end_val = "";
	client.put(bucket, key, message, options, function (err, res, obj) {
        assert.ok(!err);
        assert.equal(res.statusCode, 204);

		client.index(bucket, index, begin_val, end_val, function(err, res, obj) {
			assert.ok(!err);
			assert.equal(res.statusCode, 200);
			assert.deepEqual(obj, {"keys": ["key_6"]});
		});
	});
});

specify.run(filters);
