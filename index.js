var http = require('http');
var path = require('path');
var bunyan = require('bunyan');
var url = require('url');
var mongojs = require('mongojs');
var request = require('request');
var config = require('./configs/config');

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


var PORT = config.port;

var db = mongojs(config.db.uri, config.db.collections);

http.createServer(function (req, res) {
    var url_parts = url.parse(req.url, true);
    var query = url_parts.query;
    // var appid = query.appid;
    var idfv = query.aid; // we're not using this at this time
    var user_id = query.id;
    var paths = url_parts.pathname.split('/');
    var appid = paths[1];
    var type = paths[2];
    if ((paths.length == 4 && paths[3] == '') && (type == 'zip' || type == 'raw')) {
        download(user_id, appid, type, function(error, tpath){
            if (error == null && tpath == null){
                error = 'App not found';
            }
            if (error) {
                logger.info({status: 'failed'}, error);
                res.writeHead(404, {'Content-Type': 'application/json'});
                var json = JSON.stringify({
                    'status': 'error',
                    'message': error
                });
                res.end(json);
                return ;
            }

            tpath = tpath.replace('/app/repo','/download_internal');

            res.setHeader('X-Accel-Redirect', tpath);
            res.setHeader('Content-Type', 'application/octet-stream');
            if(type=='zip'){
                logger.info({status: 'success'}, 'Successfully Served [zip] appid:'+appid+' to userid:'+user_id+', path: '+tpath);
                res.setHeader('Content-Disposition', 'attachment; filename=program.zip');
            } else {
                logger.info({status: 'success'}, 'Successfully Served [raw] appid:'+appid+' to userid:'+user_id+', path: '+tpath);
                res.setHeader('Content-Disposition', 'attachment; filename=program.raw');
            }
            res.end('');
        });
    } else {
        var error = 'Wrong request';
        logger.info({status: 'failed'}, error);
        res.writeHead(404, {'Content-Type': 'application/json'});
        var json = JSON.stringify({
            'status': 'error',
            'message': error
        });
        res.end(json);
    }
}).listen(PORT);

var download = function(user_id, appid, type, callback){
    var user_signature = normalize_user_id(user_id);
    if (user_signature === null){
        callback('User signature is invalid', null);
        return ;
    }
    var user_udid = signature_to_udid(user_signature);
    if (user_signature === null){
        callback('User udid is invalid', null);
        return ;
    }
    get_user_status(user_udid, function(error, user_status){
        if (error){
            callback(error, null);
            return ;
        }
        if (user_status == null || user_status.status != 'ok' || user_status.user_status != 1){
            error = 'User is not valid to download';
            callback(error, null);
            return ;
        }
        if (type == 'zip') {
            get_user_data(user_signature, function(error, user){
                if (user == null){
                    callback('User Not Found', null);
                    return ;
                }
                if (user.groupid == null){
                    callback('Group ID not found', null);
                    return ;
                }
                get_zip_path(appid, user.groupid, function(error, download_path){
                    if (error){
                        callback(error, null);
                        return ;
                    }
                    callback(false, download_path);
                });
            });
        } else {
            get_raw_path(appid, function(error, download_path){
                callback(false, download_path);
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
            method: 'GET',
            timeout: 10000,
            followRedirect: true,
            qs: {
                id: user_id
            },
            maxRedirects: 10
        }, function(error, response, body) {
            if (error){
                callback(error, null);
                return ;
            }
            if (response.statusCode != 200){
                callback('Connection problem to get_status api', null);
                return ;
            }
            body = JSON.parse(body);
            callback(null, body);
        });
    }
};

var get_zip_path = function(appid, groupid, callback){
    // appid = appid.toString();
    var query = {'localid': appid};

    db.repo.find(query, function(error, result){
        if (error){
            callback(error, null);
            return ;
        }
        if (result.length == 0){
            callback('No app found with this id');
            return ;
        }
        var app = result[0];
        if (app == null){
            callback('App not found', null);
            return ;
        }
        if (app.packages != undefined && app.packages[groupid]){
            var tpath = app.packages[groupid];
            callback(false, tpath);
        } else {
            callback('Package is not signed yet');
        }
    });
};

var get_raw_path = function(appid, callback){
    appid = appid.toString();
    var query = {'localid': appid};

    db.repo.find(query, function(error, result){
        if (error){
            callback(error, null);
        } else {
            var app = result[0];
            var tpath = app.location;
            callback(false, tpath);
        }
    });
};

String.prototype.rot13 = function(){
    return this.replace(/[a-zA-Z]/g, function(c){
        return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
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

console.log('Server listening on port ' + PORT);
