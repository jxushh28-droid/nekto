'use strict';
function config(env){const required=['DISCORD_TOKEN','GUILD_ID','OWNER_ID'];for(const name of required)if(!env[name]?.trim())throw Error('Set '+name+' in .env');for(const name of ['GUILD_ID','OWNER_ID'])if(!/^\d{16,22}$/.test(env[name]))throw Error(name+' must be a Discord ID');return {token:env.DISCORD_TOKEN.trim(),guildId:env.GUILD_ID,ownerId:env.OWNER_ID,relayAll:env.RELAY_ALL_MEMBERS!=='false',nektoTokens:[env.NEKTO_AUTH_TOKEN_1?.trim()||'',env.NEKTO_AUTH_TOKEN_2?.trim()||'']};}
module.exports={config};
