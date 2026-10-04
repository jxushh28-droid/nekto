// One search owner per page, shared by Discord buttons and automatic search.
function installSearchController(inspect) {
 let pending=false,sawCall=false;
 function observe(){
  const result=inspect();
  if(result.status==='in-call')sawCall=true;
  if(sawCall&&result.status==='search-ready'){pending=false;sawCall=false;}
  if(pending&&result.status==='search-ready')return {status:'search-pending',message:'Search already requested; waiting for Nekto to respond.'};
  return result;
 }
 function request(source='manual'){
  const state=observe();
  if(state.status!=='search-ready')return state;
  if(pending)return {status:'search-pending',message:'Search already requested; waiting for Nekto to respond.'};
  // Set before invoking site handlers: a second source cannot click during the transition.
  pending=true;
  try{
   const result=inspect({click:true});
   if(result.status!=='search-ready'){pending=false;return result;}
   window.__neonAudio?.automation?.({mode:'search-pending',message:'Search requested; waiting for Nekto.',source});
   return {status:'search-pending',message:'Search requested; waiting for Nekto.'};
  }catch(error){pending=false;throw error;}
 }
 window.__neonSearch={request,observe};
}
module.exports={installSearchController};
