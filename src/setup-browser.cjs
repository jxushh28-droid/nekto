'use strict';
require('dotenv').config({quiet:true});
const {resolveBrowser}=require('./browser-choice.cjs'),{spawn}=require('node:child_process'),path=require('node:path');
async function setup(){const selected=resolveBrowser();if(selected){console.log('Browser: '+selected.label+' — download skipped.');return;}
 console.log('No installed Chrome, Edge or Playwright Chromium found. Downloading Chromium with a 120-second connection timeout.');
 const cli=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'install','chromium','--no-shell'],{stdio:'inherit',env:{...process.env,PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:process.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT||'120000'}});child.once('error',reject);child.once('exit',code=>resolve(code));});
 if(code!==0)throw Error('Browser download failed. Install Chrome or Edge normally, then rerun START-BOT.cmd. Or set CHROMIUM_EXECUTABLE in .env to your installed browser executable.');
 const browser=resolveBrowser();if(!browser)throw Error('Chromium installation did not produce an available browser');console.log('Browser: '+browser.label);
}
if(require.main===module)setup().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={setup};
