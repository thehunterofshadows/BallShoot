'use strict';

const { OnlineGame } = require('./game');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class BattleGame {
  constructor(settings, roster, seed) {
    this.settings = { ...structuredClone(settings), mode: 'battle', field: 'classic' };
    this.roster = roster.map((p, seat) => ({ id: p.id, name: p.name, seat }));
    this.random = mulberry32(seed);
    this.tickId = 0; this.now = 0; this.state = 'play'; this.paused = false;
    this.pending = new Map(); this.order = []; this.winnerId = null;
    this.boards = this.roster.map(member => {
      const board = { ...member, connected: true, alive: true, place: null, game: null };
      const boardSeed = (this.random() * 0x100000000) >>> 0;
      board.game = new OnlineGame(this.settings, [member], boardSeed, { onAttack: amount => this.charge(member.id, amount) });
      return board;
    });
  }

  board(id) { return this.boards.find(b => b.id === id); }
  input(id, held) { const b=this.board(id); if(b?.alive)b.game.input(id,held); }
  fire(id) { const b=this.board(id); return !!(b?.alive&&!this.pending.has(id)&&b.game.fire(id)); }
  swap(id) { const b=this.board(id); return !!(b?.alive&&!this.pending.has(id)&&b.game.swap(id)); }
  setConnected(id, connected) {
    const b=this.board(id); if(!b)return;b.connected=!!connected;b.game.setConnected(id,connected);
  }
  setPaused(value) {
    if(this.state!=='play')return;this.paused=!!value;
    for(const b of this.boards)b.game.setPaused(this.paused);
  }
  charge(id, amount) {
    const b=this.board(id);if(!b?.alive||this.state!=='play')return;
    const old=this.pending.get(id);this.pending.set(id,{amount:(old?.amount||0)+amount,expiresAt:this.now+6});b.game.inputLocked=true;
  }
  target(id, targetId) {
    const pending=this.pending.get(id),from=this.board(id),to=this.board(targetId);
    if(!pending)throw Object.assign(new Error('No attack is ready.'),{code:'no_attack'});
    if(!from?.alive||!to?.alive||id===targetId)throw Object.assign(new Error('Choose a living opponent.'),{code:'invalid_target'});
    this.deliver(id,targetId,pending.amount);return true;
  }
  deliver(id,targetId,amount) {
    const from=this.board(id),to=this.board(targetId);if(!from?.alive||!to?.alive||id===targetId)return false;
    this.pending.delete(id);from.game.inputLocked=false;from.game.players[0].stats.attacks++;to.game.addGarbage(amount,id);
    from.game.emit('attack_sent',{targetId,amount});return true;
  }
  forfeit(id) { const b=this.board(id);if(b?.alive){this.eliminate(b,true);this.finishIfNeeded();} }
  eliminate(board, forfeited=false) {
    if(!board.alive)return;board.alive=false;board.game.state='lost';board.game.setConnected(board.id,false);
    this.pending.delete(board.id);board.game.inputLocked=false;this.order.push(board.id);board.place=this.boards.length-this.order.length+1;
    board.game.emit('eliminated',{forfeited,place:board.place});
  }
  finishIfNeeded() {
    if(this.state!=='play')return;const alive=this.boards.filter(b=>b.alive);
    if(alive.length>1)return;this.state='ended';this.paused=false;
    if(alive[0]){alive[0].place=1;this.winnerId=alive[0].id;this.order.push(alive[0].id);alive[0].game.emit('win',{place:1});}
  }
  update(dt) {
    if(this.state!=='play'||this.paused)return;dt=Math.min(.05,dt);this.now+=dt;this.tickId++;
    for(const b of this.boards)if(b.alive){b.game.update(dt);if(b.game.state==='lost')this.eliminate(b,false);}
    for(const [id,pending] of [...this.pending])if(pending.expiresAt<=this.now){
      const targets=this.boards.filter(b=>b.alive&&b.id!==id);
      if(targets.length)this.deliver(id,targets[(this.random()*targets.length)|0].id,pending.amount);else{this.pending.delete(id);const board=this.board(id);if(board)board.game.inputLocked=false;}
    }
    this.finishIfNeeded();
  }
  summary(board) {
    const g=board.game,p=g.players[0];return {id:board.id,name:board.name,seat:board.seat,connected:board.connected,alive:board.alive,place:board.place,
      score:g.score,dispScore:g.dispScore,missMeter:g.missMeter,pressure:g.pressure,perDrop:g.shotsPerDrop(),danger:g.danger,stats:p.stats};
  }
  preview(board) {
    const g=board.game,p=g.players[0];return {...this.summary(board),gridTop:g.gridTop,parityFlip:g.parityFlip,anchorRow:g.anchorRow,grid:[...g.grid.values()].map(({r,c,kind,special})=>({r,c,kind,special})),
      flights:g.flights.map(({x,y,kind,special})=>({x,y,kind,special})),player:{x:p.x,angle:p.angle,cur:p.cur},events:g.events.slice(-8),eventId:g.eventId};
  }
  stateFor(id) {
    if(this.state==='ended')return id===this.winnerId?'won':'lost';
    if(this.paused)return'paused';return this.board(id)?.alive?'play':'spectating';
  }
  snapshotFor(id, includeOverview=false) {
    const self=this.board(id),pending=this.pending.get(id);
    return {kind:'battle',tick:this.tickId,state:this.stateFor(id),now:this.now,settings:this.settings,self:self?self.game.snapshot():null,
      boards:this.boards.map(b=>this.summary(b)),overview:includeOverview?this.boards.map(b=>this.preview(b)):undefined,
      pendingTarget:pending?{amount:pending.amount,remaining:Math.max(0,pending.expiresAt-this.now)}:null,
      order:[...this.order],winnerId:this.winnerId};
  }
  snapshot(){return this.snapshotFor(this.roster[0]?.id,true);}
}

module.exports = { BattleGame };
