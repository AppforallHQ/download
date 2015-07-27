var http = require('http');
var path = require('path');
var bunyan = require('bunyan');
var url = require('url');
var mongojs = require('mongojs');
var request = require('request');

var logger = bunyan.createLogger({
    name: 'reverse-proxy',
    streams: [{
        level: 'info',
        path: '/var/log/nodejs-fileserver.log'
        // stream: process.stdout // log INFO and above to stdout
    }, {
        level: 'error',
        path: '/var/log/nodejs-fileserver.log' // log ERROR and above to a file
    }]
});


//var PORT = process.env.npm_package_config_port || 8080
var PORT = 8080;

var host = '127.0.0.1';
var port = '27017';
var dbname = 'appdb';
var databaseUrl = host+":"+port+"/"+dbname; // "username:password@example.com/mydb"
var collections = ["users", "apps"];
var db = mongojs(databaseUrl, collections);

http.createServer(function (req, res) {
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;
    var appid = query.appid;
    var user_id = query.id;
    var user = userHasRightToAccess(user_id, appid);
    if (user != false) {
        download(user_id, appid, function(error, tpath){
            if (error){
                res.writeHead(200, {"Content-Type": "application/json"});
                var json = JSON.stringify({
                    'status': 'error',
                    'message': error
                });
                res.end(json);
            } else {
                res.setHeader('X-Accel-Redirect', '/download_internal/'+tpath);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Disposition', 'attachment; filename=program.ipa');
                res.end('');
            }
        });
    } else {
        res.end('server works!');
    }
}).listen(PORT);

var userHasRightToAccess = function(user_id, appid){
    return true;
};

var download = function(user_id, appid, callback){
    var user_signature = normalize_user_id(user_id);
    var user_udid = signature_to_udid(user_signature);
    get_user_data(user_signature, function(error, user){
        if (user == null){
            callback('User Not Found', null);
        } else {
            get_user_status(user_udid, function(error, user_status){
                if (error || user_status == null || user_status.status != 'ok' || user_status.user_status != 1){
                    callback(error, null);
                } else {
                    get_download_path(user.groupid, appid, null, function(error, download_path){
                        callback(false, download_path);
                    });
                }
            });
        }
    });
};

var get_user_data = function(user_signature, callback){
    var query = {'$or': [{'signature': user_signature}, {'udid': user_signature}]};
    // db.users.find_one(query, function(error, result){
    db.users.find(query, function(error, result){
        if (error){
            callback(error, null);
        } else {
            var user = result[0];
            callback(false, user);
        }
    });
};

var get_user_status = function(user_id, callback){
    if (user_id == null || user_id.length != 40){
        callback('Invalid user_id', null);
    } else {
        var USER_STATUS_URL = 'http:?/USER_STATUS_CHECK_API';
        request({
            uri: USER_STATUS_URL,
            method: "GET",
            timeout: 10000,
            followRedirect: true,
            qs: {
                id: user_id
            },
            maxRedirects: 10
        }, function(error, response, body) {
            if (error){
                callback(error, null);
            } else {
                body = JSON.parse(body);
                callback(null, body);
            }
        });
    }
};

var get_download_path = function(groupid, appid, user_signature, callback){
    groupid = groupid.toString();
    appid = appid.toString();
    var tpath = path.join(groupid, appid);

    if (user_signature != null){
        tpath = path.join(tpath, user_signature);
    }

    tpath = path.join(tpath, 'data/program.ipa');

    callback(false, tpath);
};

var get_app_path = function(appid, callback){
    appid = appid.toString();
    var query = {'localid': appid};

    db.repo.find(query, function(error, result){
        if (error){
            callback(error, null);
        } else {
            var app = result[0];
            var tpath = app.path;
            callback(false, tpath);
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
