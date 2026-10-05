export class Transcript{
 constructor(){this.epoch=null;this.items=[];this.serial=0;}
 reset(epoch){if(this.epoch!==epoch){this.epoch=epoch;this.items=[];}}
 add(kind,text,delivery='sent'){const item={id:++this.serial,kind,text,delivery,time:Date.now()};this.items.push(item);if(this.items.length>200)this.items.shift();return item;}
}
