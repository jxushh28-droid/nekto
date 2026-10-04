'use strict';
const fs=require('node:fs'),path=require('node:path');
function installedPaths(platform=process.platform,env=process.env){
 const join=platform==='win32'?path.win32.join:path.join;
 if(platform==='win32'){
  const roots=[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env['ProgramFiles(x86)'],env.LOCALAPPDATA].filter(Boolean);
  return {chrome:[...new Set(roots.map(root=>join(root,'Google','Chrome','Application','chrome.exe')))],msedge:[...new Set(roots.map(root=>join(root,'Microsoft','Edge','Application','msedge.exe')))]};
 }
 if(platform==='darwin')return {chrome:['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],msedge:['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']};
 return {chrome:['/opt/google/chrome/chrome','/usr/bin/google-chrome-stable','/usr/bin/google-chrome'],msedge:['/opt/microsoft/msedge/msedge','/usr/bin/microsoft-edge-stable','/usr/bin/microsoft-edge']};
}
function resolveBrowser(env=process.env,options={}){
 const exists=options.exists||fs.existsSync,platform=options.platform||process.platform;
 const executable=env.CHROMIUM_EXECUTABLE?.trim();
 if(executable){if(!exists(executable))throw Error('CHROMIUM_EXECUTABLE does not point to an installed browser executable');return {label:'Configured browser',launch:{executablePath:executable}};}
 const choice=(env.BROWSER_CHANNEL||'auto').trim().toLowerCase();
 if(!['auto','chrome','msedge','chromium'].includes(choice))throw Error('BROWSER_CHANNEL must be auto, chrome, msedge or chromium');
 const candidates=installedPaths(platform,env);
 for(const channel of choice==='auto'?['chrome','msedge']:[choice]){
  if(channel==='chromium')continue;
  const file=candidates[channel].find(exists);if(file)return {label:channel==='chrome'?'Google Chrome':'Microsoft Edge',launch:{executablePath:file}};
 }
 if(choice==='auto'||choice==='chromium'){
  const bundled=options.bundledPath||require('playwright').chromium.executablePath();
  if(exists(bundled))return {label:'Playwright Chromium',launch:{channel:'chromium'}};
 }
 if(choice!=='auto')throw Error('Selected browser '+choice+' is not installed. Install it or set BROWSER_CHANNEL=auto in .env');
 return null;
}
module.exports={installedPaths,resolveBrowser};
