const express = require('express');  
const request = require('request');
const cloudscraper = require('cloudscraper');
const fetch = require('node-fetch');
const replaceStream = require('replacestream');

const chrome = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

const app = express();

app.use(function(req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Expose-Headers", "X-Final-URL");
  res.header('Cache-Control', 'public, smax-age=600, max-age=600');
  next();
});

// Must be disable before deploy
const DevMode = false;

async function getOptions () {
  if (DevMode) {
    return {
      args: [],
      executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      headless: true,
    };
  }
  return {
    args: chrome.args,
    executablePath: await chrome.executablePath,
    headless: chrome.headless,
  };
};

async function renderPage(url) {
  var html = null;
  const options = await getOptions();
  var browser = await puppeteer.launch(options);
  let page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if(req.resourceType() == 'stylesheet' || req.resourceType() == 'font' || req.resourceType() == 'image') {
      req.abort();
    } else {
      req.continue();
    }
  });
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
  await page.goto(url);
  await page.waitFor('*');
  html = await page.content();
  await browser.close();
  return html
}

function isURL(str) {
  var regex = /(http|https):\/\/(\w+:{0,1}\w*)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%!\-\/]))?/;
  var pattern = new RegExp(regex); 
  return pattern.test(str);
}

app.all('/', async (req, res, next) => {
  var url = req.query.url;
  var regex = (req.query.a) ? RegExp(req.query.a, "g") : null;

  if(!url){ // If no URL specified 
	  return res.send("Hello World");
  }
  
  if(!isURL(url)){ // if URL is not valid
	  return res.send("ERROR: URL NOT VALID");
  }
  
  if(req.query.cf && !req.query.js) {
    // Cloudflare support
    let result = await cloudscraper.get({
      url: url,
      gzip: true,
      followAllRedirects: true
    });
    if(result.statusCode !== 200) return res.status(504).send("REMOTE ERROR");
    let body = (regex) ? result.body.match(regex) : result.body;
    res.header('X-Final-URL', result.finalUrl);
    res.send(body);
  } else if(req.query.js) {
    // Javascript support
    let data = await renderPage(url);
    if(data === null) return res.status(400).send("ERROR");
    data = (regex) ? data.match(regex) : data;
    res.send(data);
  } else if(regex && !req.query.b) {
    // Regex support
    req.pipe(request.get({
      url: url,
      gzip: true,
		  timeout: 1000, // Timeout for Remote Request
		}, (err, headers, body) => {
      res.send(body.match(regex));
    }).on('response', function(response) {
      res.header('X-Final-URL', response.request.uri.href);
    }).on('error', function(err) {
      res.status(504).send("REMOTE ERROR");
    }));
  } else if(regex && req.query.b) {
    // replaceStream support
    req.pipe(request.get({
      url: url,
      timeout: 1000, // Timeout for Remote Request
      gzip: true
		}).on('response', function(response) {
      res.header('X-Final-URL', response.request.uri.href);
    }).on('error', function(err) {
      res.status(504).send("REMOTE ERROR");
    })).pipe(replaceStream(regex, req.query.b, {
      limit: 5000
    })).pipe(res);
  } else {
    // Send directly
    req.pipe(request.get({
      url: url,
		  timeout: 1000, // Timeout for Remote Request
		}).on('response', function(response) {
      res.header('X-Final-URL', response.request.uri.href);
    }).on('error', function(err) {
      res.status(504).send("REMOTE ERROR");
    })).pipe(res); // Send Response
  }
});

app.all('/board', (req, res, next) => {
  const storyboard = /https:\\\/\\\/i\.ytimg\.com\\\/sb\\\/[a-z0-9_-]{11}\\\/storyboard3_L\$L\\\/\$N\.jpg\?sqp=([0-9a-z+=_-]+)\|.*M\$M#rs\$([0-9A-z+=_-]{34})\|/i;
  const videoid = /[a-z0-9_-]{11}/i;

  var id = encodeURI(req.query.v);

  if(!id){ // If no ID specified 
	  return res.status(400).send("Need video id!");
  }

  if(!videoid.test(id) || id.length !== 11) {
    return res.status(400).send("Invalid video id!");
  }

  request.get({
    url: "https://www.youtube.com/watch?v="+id,
    gzip: true,
    timeout: 1000, // Timeout for Remote Request
  }, (err, headers, body) => {
    var matchs = body.match(storyboard);
    if(matchs === null) return res.status(404).send("Board not found.");
    var url = ("https://i.ytimg.com/sb/"+id+"/storyboard3_L1/M0.jpg?sqp="+matchs[1]+"&sigh=rs%24"+matchs[2]);
    res.send(url);
  }).on('response', function(response) {
    res.header('X-Final-URL', response.request.uri.href);
  }).on('error', function(err) {
    res.status(504).send("REMOTE ERROR");
  });
});

app.all('/board/hover', async (req, res, next) => {
  const videoid = /[a-z0-9_-]{11}/i;

  var id = encodeURI(req.query.v);

  if(!id){ // If no ID specified 
	  return res.status(400).send("Need video id!");
  }

  if(!videoid.test(id) || id.length !== 11) {
    return res.status(400).send("Invalid video id!");
  }
  
  const storyboard2 = /"https:\/\/i\.ytimg\.com\/an_webp\/[0-9a-z+=_-]{11}\/mqdefault_6s\.webp\?du=3000\\u0026sqp=([0-9a-z+=_-]*)\\u0026rs=([0-9a-z+=_-]*)"/i;
  var body = await renderPage("https://www.youtube.com/results?search_query="+id+"&sp=EgIQAQ%253D%253D");
  if(body === null) return res.status(400).send("ERROR");
  let matchs = body.match(storyboard2);
  if(matchs === null) return res.status(404).send("Board not found.");
  var url = ("https://i.ytimg.com/an_webp/"+id+"/mqdefault_6s.webp?du=3000&sqp="+matchs[1]+"&rs="+matchs[2]);
  res.send(url);
});

app.all('/board/all', async (req, res, next) => {
  const storyboard = /https:\\\/\\\/i\.ytimg\.com\\\/sb\\\/[a-z0-9_-]{11}\\\/storyboard3_L\$L\\\/\$N\.jpg\?sqp=([0-9a-z+=_-]+)\|.*M\$M#rs\$([0-9A-z+=_-]{34})\|/i;
  const storyboard2 = /"https:\/\/i\.ytimg\.com\/an_webp\/[0-9a-z+=_-]{11}\/mqdefault_6s\.webp\?du=3000\\u0026sqp=([0-9a-z+=_-]*)\\u0026rs=([0-9a-z+=_-]*)"/i;
  var output = [];
  const videoid = /[a-z0-9_-]{11}/i;

  var id = encodeURI(req.query.v);

  if(!id){ // If no ID specified 
	  return res.status(400).send("Need video id!");
  }

  if(!videoid.test(id) || id.length !== 11) {
    return res.status(400).send("Invalid video id!");
  }
  
  var body;
  var matchs;
  var url;

  body = await renderPage("https://www.youtube.com/results?search_query="+id+"&sp=EgIQAQ%253D%253D");
  if(body === null) return res.status(400).send("ERROR");
  matchs = body.match(storyboard2);
  if(matchs === null) return res.status(404).send("Board not found.");
  url = ("https://i.ytimg.com/an_webp/"+id+"/mqdefault_6s.webp?du=3000&sqp="+matchs[1]+"&rs="+matchs[2]);
  output.push(url);

  body = await renderPage("https://www.youtube.com/watch?v="+id);
  if(body === null) return res.status(400).send("ERROR");
  matchs = body.match(storyboard);
  if(matchs === null) return res.status(404).send("Board not found.");
  url = ("https://i.ytimg.com/sb/"+id+"/storyboard3_L1/M0.jpg?sqp="+matchs[1]+"&sigh=rs%24"+matchs[2]);
  output.push(url);

  res.send(output);
});

function cleanResult(result) {
  return result.substring(9, result.length - 2);
}

app.all('/channels', async (req, res, next) => {
  const channel = /\/youtube\/[c|channel]\/[a-z0-9-_]*">/gi;
  var body = "";
  for (var type of ["100", "category/autos", "category/comedy", "category/education", "category/entertainment", "category/games", "category/made-for-kids", "category/music", "category/news", "category/nonprofit", "category/people", "category/animals","category/tech", "category/shows", "category/sports","category/travel"]) {
     result = await cloudscraper.get("https://socialblade.com/youtube/top/"+type+"/mostviewed");
	 body += result;
  }
  let matchs = body.match(channel);
  matchs = matchs.map(cleanResult);
  if(matchs === null) return res.status(404).send("Channels not found.");
  res.send([...new Set(matchs)]);
});

app.all('/popular', async (req, res, next) => {
  let r = await cloudscraper.get("https://invidio.us/api/v1/popular");
  let matchs = JSON.parse(r);
  matchs = matchs.map(x => x.authorUrl.substr(1));
  if(matchs === null) return res.status(404).send("Channels not found.");
  res.send([...new Set(matchs)]);
});

function isListed(uri,listing) {
    var ret=false;
    if (typeof uri == "string") {
        listing.forEach((m)=>{
	          if (uri.match(m)!=null) ret=true;
        });
    } else {            //   decide what to do when Origin is null
    	  ret=true;    // true accepts null origins false rejects them.
    }
    return ret;
}

/*
CORS Anywhere as a Cloudflare Worker!
(c) 2019 by Zibri (www.zibri.org)
email: zibri AT zibri DOT org
https://github.com/Zibri/cloudflare-cors-anywhere
*/

/*
whitelist = [ "^http.?://www.zibri.org$", "zibri.org$", "test\\..*" ];  // regexp for whitelisted urls
*/

blacklist = [ ];           // regexp for blacklisted urls
whitelist = [ "http://freestreams-live1.com" ];     // regexp for whitelisted origins

function isListed(uri,listing) {
    var ret=false;
    if (typeof uri == "string") {
        listing.forEach((m)=>{
	          if (uri.match(m)!=null) ret=true;
        });
    } else {            //   decide what to do when Origin is null
    	  ret=true;    // true accepts null origins false rejects them.
    }
    return ret;
}

addEventListener("fetch", async event=>{
    event.respondWith((async function() {
        isOPTIONS = (event.request.method == "OPTIONS");
        var origin_url = new URL(event.request.url);

        function fix(myHeaders) {
            //            myHeaders.set("Access-Control-Allow-Origin", "*");
            myHeaders.set("Access-Control-Allow-Origin", event.request.headers.get("Origin"));
            if (isOPTIONS) {
                myHeaders.set("Access-Control-Allow-Methods", event.request.headers.get("access-control-request-method"));
                acrh = event.request.headers.get("access-control-request-headers");
                //myHeaders.set("Access-Control-Allow-Credentials", "true");

                if (acrh) {
                    myHeaders.set("Access-Control-Allow-Headers", acrh);
                }

                myHeaders.delete("X-Content-Type-Options");
            }
            return myHeaders;
        }
        var fetch_url = unescape(unescape(origin_url.search.substr(1)));

        var orig = event.request.headers.get("Origin");
        
        var remIp = event.request.headers.get("CF-Connecting-IP");

        if ((!isListed(fetch_url, blacklist)) && (isListed(orig, whitelist))) {

            xheaders = event.request.headers.get("x-cors-headers");

            if (xheaders != null) {
                try {
                    xheaders = JSON.parse(xheaders);
                } catch (e) {}
            }

            if (origin_url.search.startsWith("?")) {
                recv_headers = {};
                for (var pair of event.request.headers.entries()) {
                    if ((pair[0].match("^origin") == null) && 
			(pair[0].match("eferer") == null) && 
			(pair[0].match("^cf-") == null) && 
			(pair[0].match("^x-forw") == null) && 
			(pair[0].match("^x-cors-headers") == null)
		    ) recv_headers[pair[0]] = pair[1];
                }
		    
                if (xheaders != null) {
                    Object.entries(xheaders).forEach((c)=>recv_headers[c[0]] = c[1]);
                }

                newreq = new Request(event.request,{
                    "headers": recv_headers
                });

                var response = await fetch(fetch_url,newreq);
                var myHeaders = new Headers(response.headers);
                cors_headers = [];
                allh = {};
                for (var pair of response.headers.entries()) {
                    cors_headers.push(pair[0]);
                    allh[pair[0]] = pair[1];
                }
                cors_headers.push("cors-received-headers");
                myHeaders = fix(myHeaders);

                myHeaders.set("Access-Control-Expose-Headers", cors_headers.join(","));

                myHeaders.set("cors-received-headers", JSON.stringify(allh));

                if (isOPTIONS) {
                    var body = null;
                } else {
                    var body = await response.arrayBuffer();
                }

                var init = {
                    headers: myHeaders,
                    status: (isOPTIONS ? 200 : response.status),
                    statusText: (isOPTIONS ? "OK" : response.statusText)
                };
                return new Response(body,init);

            } else {
      //           var myHeaders = new Headers();
      //           myHeaders = fix(myHeaders);

      //           if (typeof event.request.cf != "undefined") {
      //               if (typeof event.request.cf.country != "undefined") {
      //                   country = event.request.cf.country;
      //               } else
      //                   country = false;

      //               if (typeof event.request.cf.colo != "undefined") {
      //                   colo = event.request.cf.colo;
      //               } else
      //                   colo = false;
      //           } else {
      //               country = false;
      //               colo = false;
      //           }

      //           return new Response(
      //           	"CLOUDFLARE-CORS-ANYWHERE\n\n" + 
      //           	"Source:\nhttps://github.com/Zibri/cloudflare-cors-anywhere\n\n" + 
      //           	"Usage:\n" + origin_url.origin + "/?uri\n\n" +
			// "Donate:\nhttps://paypal.me/Zibri/5\n\n" +
      //           	"Limits: 100,000 requests/day\n" + 
      //           	"          1,000 requests/10 minutes\n\n" + 
      //           	(orig != null ? "Origin: " + orig + "\n" : "") + 
      //           	"Ip: " + remIp + "\n" + 
      //           	(country ? "Country: " + country + "\n" : "") + 
      //           	(colo ? "Datacenter: " + colo + "\n" : "") + "\n" + 
      //           	((xheaders != null) ? "\nx-cors-headers: " + JSON.stringify(xheaders) : ""),
      //           	{status: 200, headers: myHeaders}
      //           );
            }
        } else {

            // return new Response(
            //     "Create your own cors proxy</br>\n" + 
            //     "<a href='https://github.com/Zibri/cloudflare-cors-anywhere'>https://github.com/Zibri/cloudflare-cors-anywhere</a></br>\n" +
            //     "\nDonate</br>\n" +
            //     "<a href='https://paypal.me/Zibri/5'>https://paypal.me/Zibri/5</a>\n",
            //     {
            //         status: 403,
            //         statusText: 'Forbidden',
            //         headers: {
            //             "Content-Type": "text/html"
            //         }
            //     });
        }
    }
    )());
});

module.exports = app;
