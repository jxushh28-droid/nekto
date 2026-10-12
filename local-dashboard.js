// The password-free mode is only for the loopback-bound local helper.
export function localRequestError(req,path,env=process.env){
 const ports=new Set([String(env.PORT||3000),String(env.LOCAL_DASHBOARD_PORT||3100)]);
 const hosts=new Set([...ports].flatMap(port=>['127.0.0.1:'+port,'localhost:'+port]));
 const host=req.headers.host;
 if(!hosts.has(host))return 'Use the local dashboard address.';
 if(path==='/health'&&req.method==='GET')return null;
 const origin=req.headers.origin;
 if(origin&&origin!=='http://'+host)return 'Invalid origin';
 if(req.headers['sec-fetch-site']==='cross-site')return 'Invalid origin';
 if(req.method==='POST'&&origin!=='http://'+host)return 'A local dashboard origin is required.';
 return null;
}

export function localDashboardHtml(html){
 // Keep the login ID for the existing refresh handlers, but remove the form.
 return html.replace(/<section\b[^>]*\bid="login"[^>]*>[\s\S]*?<\/section>/,'<section id="login" hidden></section>');
}
