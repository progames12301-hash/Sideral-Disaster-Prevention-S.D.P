export class RadarAnimation {
  constructor(onFrame){this.onFrame=onFrame;this.count=0;this.index=0;this.speed=1;this.playing=false;this.timer=null}
  setFrames(count,index=Math.max(0,count-1)){this.pause();this.count=count;this.index=Math.min(Math.max(0,index),Math.max(0,count-1));return this.onFrame(this.index)}
  setSpeed(speed){this.speed=Number(speed)||1;if(this.playing){this.pause();this.play()}}
  async go(index){if(!this.count)return;this.index=(index+this.count)%this.count;await this.onFrame(this.index)}
  previous(){return this.go(this.index-1)} next(){return this.go(this.index+1)}
  play(){if(this.count<2||this.playing)return;this.playing=true;const tick=async()=>{if(!this.playing)return;const started=performance.now();await this.next();if(this.playing){const delay=Math.max(150,900/this.speed),elapsed=performance.now()-started;this.timer=setTimeout(tick,Math.max(0,delay-elapsed))}};this.timer=setTimeout(tick,Math.max(150,900/this.speed))}
  pause(){this.playing=false;clearTimeout(this.timer);this.timer=null}
  toggle(){this.playing?this.pause():this.play();return this.playing}
  destroy(){this.pause()}
}
