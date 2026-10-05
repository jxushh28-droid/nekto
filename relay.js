export const labels=['Первый','Второй','Третий','Четвёртый'];
export class Relay{
 constructor(){this.enabled=false;this.run=0;this.members=Array.from({length:4},()=>({connected:false,epoch:null,queue:[],received:0,sent:0,error:''}));}
 toggle(value){this.enabled=value;this.run++;for(const m of this.members)m.queue=[];}
 update(i,state){const m=this.members[i];if(m.epoch!==state.epoch||m.connected!==state.connected){m.queue=[];m.greeted=false;}Object.assign(m,{epoch:state.epoch,connected:state.connected});}
 enqueue(target,item){const m=this.members[target];if(m.queue.length>=40){m.error='Queue full';return;}m.queue.push({...item,targetEpoch:m.epoch,run:this.run,created:Date.now()});}
 incoming(i,text){if(!this.enabled||!this.members[i].connected||!text.trim())return;this.members[i].received++;for(let j=0;j<4;j++)if(j!==i&&this.members[j].connected)this.enqueue(j,{text:text+' - '+labels[i],source:i,sourceEpoch:this.members[i].epoch});}
 valid(i,item){const m=this.members[i],s=this.members[item.source];return this.enabled&&item.run===this.run&&m.connected&&m.epoch===item.targetEpoch&&Date.now()-item.created<30000&&(item.source==null||(s.connected&&s.epoch===item.sourceEpoch));}
}
