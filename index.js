var http = require('http');
var path = require('path');
var logger = require('morgan');
var url = require('url');
var mongojs = require('mongojs');
var request = require('request');

//var PORT = process.env.npm_package_config_port || 8080
var PORT = 8080;

var host = '127.0.0.1';
var port = '27017';
var dbname = 'appdb';
var databaseUrl = host+":"+port+"/"+dbname; // "username:password@example.com/mydb"
console.log(databaseUrl);
var collections = ["users", "apps"];
var db = mongojs(databaseUrl, collections);

http.createServer(function (req, res) {
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;
    var ipfv = query.aid;
    var appid = query.appid;
    var user_id = query.user_id;
    var user = userHasRightToAccess(ipfv, appid);
    if (user != false) {
        var download = download(user_id, appid, ipfv, function(result){
            res.setHeader('X-Accel-Redirect', '/assets'+url_parts.pathname);
            res.end('');
        });
    } else {
        console.log(req.url);
        res.end('server works!');
    }
}).listen(PORT);

var userHasRightToAccess = function(FQDNv, appid){
    return true;
};

var download = function(user_id, appid, ipfv){
    var user_signature = normalize_user_id(user_id);
    var user_udid = signature_to_udid(user_signature);
    var user = get_user_data(user_signature, function(error, result){
        if (error){
            console.log(error);
        }
        console.log(result);
    });
};

var get_user_data = function(user_signature, idfv, callback){
    var query = {'$or': [{'signature': user_signature}, {'udid': user_signature}]};
    if (idfv != null){
        query['idfv'] = idfv;
    }
    db.users.find_one(query, function(error, result){
        if (error){
            callback(error, null);
        } else {
            callback(false, result);
        }
    });
};

var get_user_status = function(user_id, idfv, callback){
    if (user_id == null && user_id.length != 40){
        callback('Invalid user_id', null);
    }
    var USER_STATUS_URL = 'http:?/USER_STATUS_CHECK_API';
    request({
        uri: USER_STATUS_URL,
        method: "GET",
        timeout: 10000,
        followRedirect: true,
        form: {
            id: user_id
        },
        maxRedirects: 10
    }, function(error, response, body) {
        if (error){
            console.log(error);
            callback(error, null);
        } else {
            console.log(body);
            callback(null, body);
        }
    });
};

String.prototype.rot13 = function(){
    return this.replace(/[a-zA-Z]/g, function(c){
        return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
};

var udid_to_signature = function(udid){
    var UDID_RE = /^[a-f0-9]{40}$/;
    if (UDID_RE.test(udid)){
        return udid.rot13();
    } else {
        return null;
    }
};

var signature_to_udid = function(signature){
    var SIGNATURE_RE = /^[n-s0-9]{40}$/;
    if (SIGNATURE_RE.test(signature)){
        return signature.rot13();
    } else {
        return null;
    }
};

var normalize_user_id = function(user_id){
    var UDID_RE = /^[a-f0-9]{40}$/;
    var SIGNATURE_RE = /^[n-s0-9]{40}$/;
    if (user_id == null){
        return null;
    }
    if (UDID_RE.test(user_id)){
        return user_id.rot13();
    } else if (SIGNATURE_RE.test(user_id)){
        return user_id;
    } else {
        return null;
    }
};

console.log("Server listening on port " + PORT);
