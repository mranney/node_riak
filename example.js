var RiakClient = require("riak"), client;

client = new RiakClient(["127.0.0.1:8098"], "client_id", "pool_name");

// turn this on to see an activity trace
client.debug_mode = false;

client.on("metrics", function (type, key, val) {
    console.log("metric: " + type + ", " + key + "=" + val);
});

// GET + PUT as modify()
// This mutator function does a simple increment of prop2 with no error checking
client.modify("bucket_1", "key_1", function mutator(old, done) {
    var newobj = old || {};
    newobj.counter = newobj.counter || 0;
    newobj.counter++;
    done(newobj);
}, {}, function (err, res, obj) {
    console.error(res.statusCode + ": ", obj);
    process.exit();
});
