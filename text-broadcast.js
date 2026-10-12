import {randomUUID} from 'node:crypto';

// Validate both destinations before changing either transcript or queue.
export function queueTextBroadcast({relay, transcripts, states, text, epochs}) {
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Write a message of 1–4000 characters.');
  if(!relay.enabled)throw Error('Connect both chats before sending.');
  if(!Array.isArray(epochs)||epochs.length!==2||states.length!==2||
    states.some((state,i)=>!state?.connected||state.epoch==null||epochs[i]!==state.epoch))
    throw Error('The conversation changed. Wait for both chats before sending.');
  if(states.some((state,i)=>relay.members[i].epoch===state.epoch&&relay.members[i].queue.length>=40))
    throw Error('Message queue is full. Wait before sending again.');
  const broadcastId=randomUUID();
  states.forEach((state,i)=>{
    relay.update(i,state);transcripts[i].reset(state.epoch);
    const item=transcripts[i].add('private',text,'queued');item.broadcastId=broadcastId;
    relay.enqueue(i,{text,kind:'private',transcriptId:item.id,broadcastId});
  });
  return {ok:true,broadcastId};
}
