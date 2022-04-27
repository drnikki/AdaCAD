import { Injectable} from '@angular/core';
import { PedalsService, PedalStatus, Pedal } from '../../core/provider/pedals.service';
import { Draft } from '../../core/model/draft';
import { Operation, ServiceOp, OperationService } from '../provider/operation.service';
import { EventEmitter } from 'events';

interface PedalOp {
  id: number,
  name: string,
  op?: PlayerOp
}

interface PedalsConfig {
  numPedals: number,
  ops: Array<PlayerOp>
}

interface PlayerOp {
  id?: number,
  name: string,
  dx?: string,
  op?: ServiceOp,
  weavingOnly?: boolean,
  perform: (init: PlayerState) => Promise<PlayerState>;
}

interface LoomConfig {
  warps: number,
  draftTiling: boolean
}

export interface PlayerState {
  draft: Draft,
  row: number,
  numPicks: number,
}

export interface WeavingPick {
  pickNum: number,
  rowData: string
}

/**
 * @class PedalOpMapping
 * @desc Represents a set of two-way bindings between a set of Pedals
 * and a set of (Player)Operations. An Op can only be bound to one Pedal, 
 * and a Pedal can only be bound to one Op
 * 
 * @todo The second restriction may change, it might make sense for pedals to
 * get bound to a sequence of operations.
 */
class PedalOpMapping {
  // numPedals: number;
  pedals: Array<Pedal>;
  ops: Array<PlayerOp>;
  unpairedOps: Array<PlayerOp>;
  pairs: any;  // pedal ID (number) <-> op (PlayerOp)

  constructor(pedalArray) {
    this.pedals = pedalArray;
    this.ops = []
    this.unpairedOps = [];
    this.pairs = {};

    // if (loadConfig) {
    //   for (var i of loadConfig.ops) {
    //     this.pair(i, loadConfig.ops[i]);
    //   }
    // } 
  }

  get numPedals() {
    return this.pedals.length;
  }

  get numPairs() {
    return Object.entries(this.pairs).length;
  }

  addPedal(p: Pedal) {
    this.pedals.push(p);
  }

  addOperation(o: PlayerOp) {
    o.id = this.ops.length;
    this.ops.push(o);
    this.unpairedOps.push(o);
    // console.log(this.ops);
  }

  pair(pedalId: number, opName: string) {
    let o = this.unpairedOps.findIndex((op) => op.name == opName);
    let thisOp = this.unpairedOps.splice(o, 1);
    this.pairs[pedalId] = thisOp[0];
  }

  opIsPaired(opName: string) {
    let opPairs;
    // console.log(this.pairs);
    if (this.numPairs > 0) {
      opPairs = Object.values(this.pairs).map((x: PlayerOp) => x.name);
    }
    // console.log(opPairs);
    return (opPairs.indexOf(opName));
  }

  pedalIsPaired(pedalId: number) {
    return (this.pairs[pedalId]);
  }

  unpairPedal(id: number) {
    console.log(`unpairing pedal ${id}`);
    let op = this.pairs[id];
    this.unpairedOps.splice(op.id, 0, op);
    delete this.pairs[id];
  }

  unpairOp(name: string) {
    let pid = this.opIsPaired(name);
    this.unpairPedal(pid);
  }
}


const forward: PlayerOp = {
  name: 'forward',
  perform: (init: PlayerState) => { 
    let nextRow = (init.row+1) % init.draft.wefts;
    return Promise.resolve({ draft: init.draft, row: nextRow, numPicks: init.numPicks+1 }); 
  }
}

const refresh: PlayerOp = {
  name: 'refresh',
  perform: (init: PlayerState) => Promise.resolve(init)
}

const reverse: PlayerOp = {
  name: 'reverse',
  perform: (init: PlayerState) => { 
    let nextRow = (init.row-1) % init.draft.wefts;
    return Promise.resolve({ draft: init.draft, row: nextRow, numPicks: init.numPicks+1});
  }
}

function playerOpFrom(op: ServiceOp) {
  // use "rotate" op as an example
  let perform = function(init: PlayerState) {
    let resultDraft: Draft;
    let opInput = [{
      params: [1],
      drafts: [init.draft],
      op_name: "",
      inlet: null
    }];
    let result = Promise.resolve(op.perform(opInput));
    return result.then((p) => { 
      return { draft: p[0], row: init.row, numPicks: init.numPicks };
    });
  }
  var p: PlayerOp = { 
    name: op.name,
    op: op,
    perform: perform
  }
  return p;
}

@Injectable({
  providedIn: 'root'
})
export class DraftPlayerService {
  state: PlayerState;
  // draft: Draft;
  loom: LoomConfig;
  pedalOps: PedalOpMapping;
  // options: Array<PlayerOp> = [];

  // pairs = {}; // pedal ID -> op name
  // opsDict = {};     // op name -> pedal ID

  redraw = new EventEmitter();

  constructor(
    public pds: PedalsService,
    private oss: OperationService
  ) {
    // this.draft = null; 
    console.log("draft player constructor");
    const startPattern = this.oss.getOp('tabby');
    console.log(startPattern);
    const nullOpInput = [{
      params: [1],
      drafts: [],
      op_name: "",
      inlet: null
    }];
    startPattern.perform(nullOpInput).then((result) => {
      console.log(result);
      this.setDraft(result[0]);
    });

    this.state = { draft: null, row: -1, numPicks: 0 };
    this.loom = { warps: 1320, draftTiling: true };

    this.pedalOps = new PedalOpMapping(this.pedals);

    this.pedalOps.addOperation(forward);
    this.pedalOps.addOperation(refresh);
    this.pedalOps.addOperation(reverse);

    let rotate = <ServiceOp> this.oss.getOp('rotate');
    this.pedalOps.addOperation(playerOpFrom(rotate)); 

    this.pds.pedal_array.on('pedal-added', (num) => {
      console.log("automatically pairing first pedal", num);
      if (num == 1) {
        console.log(this.pedalOps);
        this.setPedalOp({value: 'forward'}, this.pedals[0]);
      }
    });
    this.pds.pedal_array.on('child-change', (e) => this.onPedal(e.id));
  }

  get pedals() { return this.pds.pedals; }
  get readyToWeave() {
    return (this.pds.readyToWeave && (this.pedalOps.opIsPaired('forward') > -1));
  }
  get weaving() {
    return this.pds.active_draft.val;
  }
  get draft() {
    return this.state.draft;
  }

  // addPedalOption(op: PlayerOp) {
  //   if (op.pedal < 0) {
  //     this.options.push(op);
  //     this.opsDict[op.name] = -1;
  //   }
  // }

  setDraft(d: Draft) {
    this.state.draft = d;
    this.state.row = 0;
    // console.log("player has active draft");
    // console.log("draft is ", this.draft);
    console.log("state is ", this.state);
  }

  // e is from select event, with value = op name (string)
  setPedalOp(e: any, p: Pedal) {
    console.log(e, p);
    if (this.pedalOps.pedalIsPaired(p.id)) {
      this.pedalOps.unpairPedal(p.id);
    }
    this.pedalOps.pair(p.id, e.value);
    console.log("pedals dict", this.pedalOps.pairs);
  }

  onPedal(id: number) {
    if (this.pedalOps[id]) {
      this.pedalOps[id].perform(this.state)
      .then((state: PlayerState) => {
        this.state = state;
        this.redraw.emit('redraw');
        if (this.weaving) {
          this.pds.loom_ready.once('change', (state) => {
            if (state) {
              console.log("draft player: sending row");
              this.pds.sendDraftRow(this.currentRow());
            }
          })
        }
      });
    }
  }

  currentRow() {
    console.log(this.state);
    let {draft, row} = this.state;
    let draftRow = draft.pattern[row % draft.wefts];
    let data = "";

    let targetLength = (this.loom.draftTiling ? this.loom.warps : draftRow.length);
    while (data.length < targetLength) {
      for (var i in draftRow) {
        if (draftRow[i].is_up) {
          data += '1';
        } else {
          data += '0';
        }
      }
    }
    let pick: WeavingPick = { pickNum: row, rowData: data };
    return pick;
  }

  toggleDraftTiling(e) {
    // console.log("toggle ", e);
    this.loom.draftTiling = e.checked;
    // console.log("draft tiling ", this.loom.draftTiling);
  }

  changeLoomWidth(e) {
    // console.log(e.target.value);
    this.loom.warps = e.target.value;
    // console.log("warps", this.loom.warps);
  }

  toggleWeaving() {
    // don't let user start weaving until AT LEAST:
    // - 1 pedal connected AND
    // - 1 pedal configured with operation "forward"
    this.pds.toggleWeaving();
    this.pds.vacuum_on.once('change', (state) => {
      if (state) {
        this.pds.sendDraftRow(this.currentRow());
      }
    });
  }
}