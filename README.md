node_riak
=========

Riak client for node.js

This is the client that we use at Voxer.  It's been tested very thoroughly in our environment and for our usage patterns, but
there may be glaring holes in functionality that we don't use.

It uses the "poolee" module to do load balancing and failure detection so you don't necessarily need a load balancer between node
and Riak.

The library has support for timing each request, resolving siblings, and conditional retry.

## API

### Constructor

    var RiakClient = require("riak"), client;
    client = new RiakClient(["host1:port1", "host2:port2", ... "hostn:portn"], "client_id", "pool_name");

The `RiakClient` constructor takes a list of host:port pairs, each of which are equivalent nodes in a Riak cluster.

## Example

There is no documentation yet, and there is only one example.  This is the best thing to look at for now.  You can run it, and you should see something like this:

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
