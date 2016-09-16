'use strict';

var express  = require('express');
var  app        = express();
var  request    = require('request');
var  vcapServices = require('vcap_services');
var  extend     = require('util')._extend;

// Bootstrap application settings
require('./config/express')(app);

// if bluemix credentials exists, then override local
var credentials =  extend({
  url: 'https://gateway.watsonplatform.net/dialog/api',
  username: '<username>',
  password: '<password>'
}, vcapServices.getCredentials('dialog', 'standard')); // VCAP_SERVICES

var apiIndex = credentials.url.indexOf('/api');
if (apiIndex > 0) {
  credentials.url = credentials.url.substring(0, apiIndex);
}

// HTTP proxy to the API
app.use('/proxy', function(req, res, next) {
  var newUrl = credentials.url + req.url;
  req.pipe(request({
    url: newUrl,
    auth: {
      user: credentials.username,
      pass: credentials.password,
      sendImmediately: true
    }
  }, next)).pipe(res);
});

// render index page
app.get('/', function(req, res) {
  res.render('index');
});

require('./config/error-handler')(app);

module.exports = app;




//instantiate our basic objects
var express = require('express')
var session = require('express-session')
var https = require('https')
var url = require('url')

var app = express()

//set up the session object
app.use(session({secret: 'somesecret'}));
var sess;

//set the configuration parameters
//client_id, redirect_uri should match the values you specified when you registered the application with AD. outh_resource is the relying party trust identifier in ADFS for CRM IFD - see https://msdn.microsoft.com/en-us/library/dn531010.aspx for more details
var client_id = 'ab762716-544d-4aeb-a526-687b73838a33';
var oauth_resource = 'https://auth.ajax.alexanderdevelopment.net';
var redirect_uri = 'http://localhost:3000/auth/callback';

//hostname and port for your CRM organization
var crm_host = 'lucas01.ajax.alexanderdevelopment.net'
var crm_port = 443;

//route for the index page
app.get('/', function (req, res) {
  res.write('<html>');
  res.write('<head><title>CRM-Node.js Oauth2 Demo - Login</title></head>');
  res.write('<body>');
  
  //get session cookie
  sess=req.session;
  
  //check if user has a token and display appropriate options
  //right now this doesn't handle expired tokens!!!
  if(sess.access_token) {
    res.write('<h2>You are logged in</h2>');
    res.write('<a href="/authenticated/contacts">Contact view</a>');
  }
  else {
    res.write('<h2>You are not logged in</h2>');
    res.write('<a href="/auth/login">Login</a>');
  }
  res.write('</body>');
  res.write('</html>');
  res.end();
})

//route for the login page - queries CRM for the authorization uri and redirects the browser
app.get('/auth/login', function (req, res) {
  //console.log("auth");
  //make sure the browser doesn't cache the redirect because then the authorization uri won't get stored for later use
  res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
  
  //set up a get request to the CRM organizationdata service to find the authorization URI - see https://msdn.microsoft.com/en-us/library/dn531009.aspx#bkmk_oauth_discovery for details

  //set a header to tell the endpoint we are looking for the oauth authorization endpoint
  var headers = {
    'Authorization': 'Bearer'
  }

  //build the request details
  var options = {
    host : crm_host,
    port : crm_port,
    path : '/XRMServices/2011/OrganizationData.svc/web?SdkClientVersion=6.1.0.533', 
    method : 'GET',
    rejectUnauthorized: false,//to allow for self-signed SSL certificates - use at your own risk!!!
    headers : headers //set in the previous step
  };

  //make the request - the authorization uri is returned in the www-authenticate header
  var reqGet = https.request(options, function(resGet) {
    //log all the headers
    //console.log("headers: ", resGet.headers);
    
    //get the www-authenticate header
    var authheader = resGet.headers['www-authenticate'];
    
    //strip out the bearer authorization uri bit at the beginning
    var authuri = authheader.replace('Bearer authorization_uri=','');
    
    //drop anything that ADFS includes in that header anything after the uri
    if(authuri.indexOf(',')>0) {
      authuri = authuri.substr(0, authuri.indexOf(','));
    }
    
    //log the uri, which should be just a regular url at this point
    //console.log("authuri: ", authuri);
    
    //store the authorization uri for use in the authorization callback route
    sess=req.session;
    sess.authuri = authuri;
    
    //redirect the browser to the authorization uri with the proper query string - see https://github.com/nordvall/TokenClient/wiki/OAuth-2-Authorization-Code-grant-in-ADFS for details
    res.redirect(authuri+'?response_type=code&client_id='+client_id+'&resource='+oauth_resource+'&redirect_uri='+redirect_uri);
  });
  reqGet.end();
  
  //handle errors
  reqGet.on('error', function(e) {
    console.error(e);
  });
})

//this page handles the callback from AD FS with the authorization code
app.get('/auth/callback', function (req, res) {
  //get a reference to the session cookie
  sess=req.session;
  
  //parse the authorization code from the querystring
  var authcode = req.query.code;

  //now we need to post the authorization code to AD FS to get the access token
  //get the original authuri from the session cookie - we need to know the host and port number
  var authuri = sess.authuri;
  var parsedauthuri = url.parse(authuri);

  //prepare the header for the post request
  var headers = {
    'Content-Type' : 'application/x-www-form-urlencoded'
  };

  //set options for the post request
  var options = {
    host : parsedauthuri.hostname,
    port : parsedauthuri.port,
    path : '/adfs/oauth2/token',
    method : 'POST',
    rejectUnauthorized: false, //to allow for self-signed SSL certificates - use at your own risk!!!
    headers : headers //set in the previous step
   };

  //build the post string
  var formvals = 'client_id='+client_id+'&redirect_uri='+redirect_uri+'&grant_type=authorization_code&code='+authcode;

  //set up the post request
  var reqPost = https.request(options, function(resPost) {
    //log headers and post string
    //console.log("headers: ", resPost.headers);
    //console.log("formvals: ", formvals);

    //set up the event handler for when we get a response
    resPost.on('data', function(d) {
      //parse the response to extract the token
      var json = JSON.parse(d);

      //log it
      //console.log('token response: ' + json);

      //if we get an error, show it to the client
      if(json.error) {
        res.write(json.error);
      }
      else {
      //no error, so let's store the token values in a session cookie
        sess.access_token=json.access_token;
        sess.refresh_token=json.refresh_token;

        //send the visitor back to the index page
        res.redirect('/');
      }
    });
  });

  //actually make the post request
  reqPost.write(formvals);
  reqPost.end();

  //handle errors
  reqPost.on('error', function(e) {
    console.error(e);
  });
})

//this page queries CRM for the entire contact set using the access token stored in the session cookie
app.get('/authenticated/contacts', function (req, res) {
  //get the session cookie
  sess=req.session;
  
  //if user has an access token then get the contacts
  //right now this doesn't handle expired tokens!!!
  if(sess.access_token) {
    res.write('<html>');
    res.write('<head><title>CRM-Node.js Oauth2 Demo - Contacts</title></head>');
    res.write('<body>');
    res.write('<h2>Contacts</h2>');
    // Set the headers for the call to CRM
    var headers = {
      'Authorization': 'Bearer ' + sess.access_token, //send the oauth access token to authenticate
      'Accept': 'application/json' //tell CRM to send json data back
    }

    //configure the CRM odata request
    var options = {
      host : crm_host,
      port : crm_port,
      path : '/XRMServices/2011/OrganizationData.svc/ContactSet?$select=FullName', //hardcoded to select just the contact name
      method : 'GET',
      rejectUnauthorized: false,//to allow for self-signed SSL certificates - use at your own risk!!!
      headers : headers //set in the previous step
    };
    
    var reqGet = https.request(options, function(resGet) {
      //should do something here if we get 'www-authenticate': 'Bearer error' response headers
      //console.log("headers: ", resGet.headers);
      
      resGet.on('data', function(d) {
        //console.info('raw response: ' + d);
        var json = JSON.parse(d);
        var records = json.d.results;
        
        //console.info('results: ' + JSON.stringify(records));
        for (var i in records) {   
          res.write(records[i].FullName + '<br />');
        }
        res.write('</body>');
        res.write('</html>');
        res.end();
      });
    });
    reqGet.end();
    
    //handle errors
    reqGet.on('error', function(e) {
      console.error(e);
    });
  }
  else {
    //not logged in, show a link to the login page
    res.write('<html>');
    res.write('<head><title>CRM-Node.js Oauth2 Demo - Contacts</title></head>');
    res.write('<body>');
    res.write('<h2>You are not logged in</h2>');
    res.write('<a href="/auth/login">Login</a>');
    res.write('</body>');
    res.write('</html>');
    res.end();
  }
});    

//set up the server and start listening for requests
var server = app.listen(3000, function () {
  var host = server.address().address
  var port = server.address().port
  console.log('App listening at http://%s:%s', host, port)
})