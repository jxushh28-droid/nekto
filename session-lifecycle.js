// Retire the exact session that ended, leaving the other side and saved tokens intact.
export async function closeSession({slots,index,expected=slots[index],relay,transcript,tokenStatus,path}){
 if(!expected||slots[index]!==expected)return false;
 slots[index]=null;relay.update(index,{connected:false,epoch:null});relay.members[index].error='';transcript.reset(null);tokenStatus[index]=false;
 try{await expected.context.storageState({path});}catch{}
 await expected.context.close();return true;
}
