import {getIronSession} from 'iron-session';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const APP='https://raneen-ooh.vercel.app';
const HOME='/ooh/field/';
const COOKIE='__Host-raneen-google';
function redirect(res,path){res.statusCode=303;res.setHeader('Location',path);res.end();}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export default async function handler(req,res){
res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
const url=new URL(req.url,APP);const action=url.pathname.split('/').pop();
if(!['start','callback','session','logout'].includes(action))return json(res,404,{error:'not_found'});
if((action==='session'||action==='logout')&&(req.method!=='POST'||req.headers.origin!==APP))return json(res,403,{error:'forbidden'});
if((action==='start'||action==='callback')&&req.method!=='GET')return json(res,405,{error:'method_not_allowed'});
const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET,password=process.env.OAUTH_COOKIE_SECRET;
if(!clientId||!clientSecret||!password||password.length<32)return json(res,503,{error:'oauth_setup_required'});
try{
const session=await getIronSession(req,res,{cookieName:COOKIE,password,ttl:60*60*24*180,cookieOptions:{secure:true,httpOnly:true,sameSite:'lax',path:'/'}});
if(action==='logout'){session.destroy();return json(res,200,{ok:true});}
if(action==='start'){
session.state=randomBytes(32).toString('base64url');session.verifier=randomBytes(48).toString('base64url');session.started=Date.now();await session.save();
const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:clientId,redirect_uri:APP+'/api/google/callback',response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.file',access_type:'offline',prompt:'consent',state:session.state,code_challenge:createHash('sha256').update(session.verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return redirect(res,auth.href);
}
let body;
if(action==='callback'){
if(!equal(url.searchParams.get('state'),session.state)||!session.started||Date.now()-session.started>600000)return redirect(res,HOME+'?google=invalid');
const verifier=session.verifier;delete session.state;delete session.verifier;delete session.started;await session.save();
if(url.searchParams.has('error'))return redirect(res,HOME+'?google=denied');
const code=url.searchParams.get('code');if(!code)return redirect(res,HOME+'?google=invalid');
body={code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:APP+'/api/google/callback'};
}else{
if(!session.refreshToken)return json(res,401,{error:'consent_required'});
body={refresh_token:session.refreshToken,grant_type:'refresh_token'};
}
const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(15000)});
const result=await response.json();
if(!response.ok){if(result.error==='invalid_grant'){session.destroy();return action==='callback'?redirect(res,HOME+'?google=denied'):json(res,401,{error:'consent_required'});}return action==='callback'?redirect(res,HOME+'?google=failed'):json(res,502,{error:'provider_unavailable'});}
if(!result.access_token||!Number.isFinite(result.expires_in))return json(res,502,{error:'invalid_provider_response'});
if(result.refresh_token){session.refreshToken=result.refresh_token;await session.save();}
if(action==='callback'){if(!session.refreshToken)return redirect(res,HOME+'?google=failed');return redirect(res,HOME);}
return json(res,200,{access_token:result.access_token,expires_in:result.expires_in});
}catch{return action==='callback'?redirect(res,HOME+'?google=failed'):json(res,502,{error:'session_unavailable'});}
}
