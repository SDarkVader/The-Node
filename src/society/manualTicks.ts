/** Operator-only permits. A click admits one whole day within an already approved plan. */
export class ManualTickGate {
  #waiting: {day:number;resolve:()=>void;reject:(error:Error)=>void;cleanup:()=>void}|null=null;
  #closed=false;
  #version=0;
  get state(){return {waitingDay:this.#waiting?.day??null,closed:this.#closed,version:this.#version};}
  wait(day:number,signal?:AbortSignal):Promise<void>{
    if(this.#closed||signal?.aborted)return Promise.reject(Error('society_cancelled'));
    if(this.#waiting||!Number.isSafeInteger(day)||day<1)throw Error('society_tick_permit_state');
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.#waiting=null;this.#version++;reject(Error('society_cancelled'));};
      signal?.addEventListener('abort',abort,{once:true});
      this.#waiting={day,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};this.#version++;
      if(signal?.aborted){this.#waiting.cleanup();abort();}
    });
  }
  advance(day:number):void{
    const pending=this.#waiting;
    if(this.#closed||!pending||pending.day!==day)throw Error('society_tick_not_waiting');
    this.#waiting=null;this.#version++;pending.cleanup();pending.resolve();
  }
  close():void{
    if(this.#closed)return;this.#closed=true;this.#version++;
    const pending=this.#waiting;this.#waiting=null;
    if(pending){pending.cleanup();pending.reject(Error('society_cancelled'));}
  }
}
