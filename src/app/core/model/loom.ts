import { connectableObservableDescriptor } from 'rxjs/internal/observable/ConnectableObservable';
import utilInstance from './util';

/**
 * Definition of threading class.
 * @class
 */
const countOccurrences = (blah, val) => blah.reduce((a, v) => (v === val ? a + 1 : a), 0);

 
export class Loom{
    type: string;
    epi: number;

    //1-d array the same size as warps that has the id for the frame it is associated with or -1. 
    threading: Array<number>; 
    min_frames: number; 
    num_frames: number; //the number frames in use
    
    //1-d array the same size as wefts that has the id for the frame it is associated with or -1. 
    treadling: Array<number>;
    min_treadles: number;
    num_treadles: number;

    // 2-d arraw of size frames x treadles
    tieup: Array<Array<Boolean>>; 


    constructor(type: string, wefts: number, warps: number, epi:number, frames: number, treadles:number) {

        this.type = type;
        this.epi = epi;
        this.min_frames = frames;
        this.min_treadles = treadles;
        this.num_frames = frames;
        this.num_treadles = treadles;

        this.resetThreading(warps);
        this.resetTreadling(wefts);
        this.resetTieup(frames, treadles);
      
    }


    resetThreading(warps){
      this.threading = [];
        for (var i = 0; i < warps; i++) {
            this.threading.push(-1);
        }
    }

    resetTieup(frames, treadles){

      this.tieup = [];
        for (var i = 0; i < frames; i++) {
            this.tieup.push([]);
            for(var j = 0; j < treadles; j++){
              this.tieup[i].push(false);
            }
        }
    }

    resetTreadling(wefts){

        this.treadling = [];
        for (var i = 0; i < wefts; i++) {
            this.treadling.push(-1);
        }
    }

    // repopulateLoomFromDrawdown(drawdown){

    //   for(var i in drawdown){
    //     for(var j in drawdown[i]){
    //       this.updateConfig(this.getConfig({i: i, j:j, drawdown: drawdown}));
    //     }
    //   }

    // }


   /* updates the threading, tieup, and treadling based on a point in the drawdown
   * @param {i,j} the Row, Column of the changed pixel.
   * @returns {a list of updates made}
   */
    updateFromDrawdown(i, j, drawdown){
      return this.updateConfig(this.getConfig({i: i, j:j, drawdown: drawdown}));
    }


    getEmptyTreadle(){

      for(var i = 0; i < this.num_treadles; i++){
        const idx = this.treadling.find(element => element === i);
        if(idx === undefined) return i;
      }

      return this.num_treadles;
    }

    //this will always get the first empty frame
    getEmptyFrame(){

      for(var i = 0; i < this.num_frames; i++){
        const idx = this.threading.find(element => element === i);
        if(idx === undefined) return i;
      }

      return this.num_frames;
    }




   /* This function takes a point from the draw down [i,j] representing rows and columns 
and returns an associated value for threading frames and treadles
   * @param obj{i: i,j: j} the Row, Column of the changed pixel.
   * @returns {obj{i: i, j: j, frame: number, treadle: number}}
   */

    getConfig(obj){


      var config = {
        i: obj.i, 
        j: obj.j,
        frame: -1,
        treadle:-1,
        drawdown: obj.drawdown
      }

      var j_pattern = obj.drawdown.map(element => element[obj.j]);
      var i_pattern = obj.drawdown[obj.i];


      //(1) check if the row is unique
      var found = false;
      for(var i = 0; i < obj.drawdown.length && !found; i++){
        
        //don't check the row we are currently in
        if(i != obj.i){
          //need a way to check here if it is the ONLY one assigned to this frame, or if others are as well
          const idx = obj.drawdown[i].find((element, ndx) => element !== i_pattern[ndx]);
          if(idx === undefined){
              found = true;
              config.treadle = this.treadling[i];
          }
        }
      }

      if(!found){
        var count = countOccurrences(this.treadling, this.treadling[obj.i]);
        if(this.treadling[obj.i] != -1 && count == 1){
          config.treadle = this.treadling[obj.i];
        }else{
          config.treadle = this.getEmptyTreadle();
        }
      }

     //(1) check if the column is unique
      found = false;
      for(var j = 0; j < obj.drawdown[0].length && !found; j++){
        if(j != obj.j){
          const col = obj.drawdown.map(element => element[j]);
          const idx = col.find((element, ndx) => element !== j_pattern[ndx]);

          if(idx === undefined){
              found = true;
              config.frame = this.threading[j];
          }
        }
      }


      if(!found ){
        var count = countOccurrences(this.threading, this.threading[obj.j]);
        if(this.threading[obj.j] != -1 && count == 1){
          config.frame = this.threading[obj.j];
        }else{
          config.frame = this.getEmptyFrame();
          console.log("got new frame at ", config.frame);

        }
      }

      return config;
    }





/***
   /* This function updates the values of the treadles, 
   threading and tie up based on a returned value 
   from getConfig
   * @param obj{i: i,j: j} the Row, Column of the changed pixel.
   * @returns a list of the updated points {obj{threading: array<{i,j}>, treadling: array<{i,j}>, tieup  array<{i,j}}}
   */   
      
    updateConfig(config){
      var updates = {
        threading: [],
        treadling: [],
        tieup: []
      }


      console.log("update config", config.i, config.j);


      //recreate the tieup for updates
      for(var i = 0; i < this.tieup.length; i++){
        updates.tieup.push([]);
        for(var j = 0; j < this.tieup[i].length; j++){
            updates.tieup[i].push({i: i, j:j, val: this.tieup[i][j]});
        }
      }


      //if this is within the existing frames
      if(config.frame < this.num_frames){
        console.log("In Frame Range", config.frame);
        
        if(this.threading[config.j] != -1){
          updates.threading.push({i: this.threading[config.j], j: config.j, val: false});
        }

        this.threading[config.j] = config.frame;
        updates.threading.push({i: config.frame, j: config.j, val: true});


      }else{
        //this may be by more than one extra frame
        console.log("Out of Frame Range", config.frame);
        
        //add a frame and then assign this to it
        this.threading[config.j] = config.frame;
        updates.threading.push({i: config.frame, j: config.j, val: true})

        for(var d = this.num_frames; d <= config.frame; d++){
          this.tieup.push([]); //add a new row to the tieup, fill it with false
          updates.tieup.push([]);
          
          for(var t = 0; t < this.num_treadles; t++){
            this.tieup[d].push(false);
            updates.tieup[d].push({i: d, j: t, val: false});
          }
        }

        this.num_frames = (config.frame+1);
        console.log(this.tieup);

      }




      if(config.treadle < this.num_treadles){
        
        if(this.treadling[config.i] != -1){
          updates.treadling.push({i: config.i, j: this.treadling[config.i], val: false});
          this.treadling[config.i] = -1;

        }

        this.treadling[config.i] = config.treadle;
        updates.treadling.push({i: config.i, j:  config.treadle, val: true});

      }else{

        var diff = config.treadle - (this.num_treadles-1);


        this.treadling[config.i] = config.treadle;
        updates.treadling.push({i: config.i, j:  config.treadle, val: true});

        for(var d = this.num_treadles; d <= config.treadle; d++){
          for(var f = 0; f < this.num_frames; f++){
            this.tieup[f].push(false);
            updates.tieup[f].push({i: f, j: d, val: false});

          }
        }

        this.num_treadles = (config.treadle+1);

      }

      
      //look through each treadle, and see if the tie up needs to be updated
      for(var j = 0; j < this.num_treadles; j++){
          const idx = this.treadling.findIndex(element => element === j);

        if(idx !== -1){
            //clear the tieup associated with this treadle
            for(var i = 0; i < this.num_frames; i++){
                this.tieup[i][j] = false;
                updates.tieup[i][j].val = false; 
            }
            //iterate through the row in question and update tieups
            for(var jj = 0; jj < config.drawdown[idx].length; jj++){
              

              if(config.drawdown[idx][jj]){

                  this.tieup[this.threading[jj]][j] = true;                  
                  updates.tieup[this.threading[jj]][j].val = true; 
              }
            }
        }
      }

      return updates;

    }


/***
   * takes in an object describing where the change in loom took place and returns a list of affected rows and columns in the draw dow
   * @param i: the tieup frame, j: the tieup treadle, value: true or false
   * @returns (wefts: array of affected rows, warps: array of affected columns)
   */  
    getAffectedDrawdownPoints(obj){
          var active_thread_cols = [];
          var active_tieup_rows = [];
          var active_tieup_cols = [];
          var active_treadle_rows = [];


      //this is a point in the threading
      if(obj.frame !== undefined && obj.warp !== undefined){
    


          //get any treadles that are connected to this frame in the tieup
          for(var j = 0; j < this.num_treadles; j++){
            if(this.tieup[obj.frame][j]){
              active_tieup_cols.push(j);
            }
          }
          for(var i = 0; i < this.treadling.length; i++){
            for(var t = 0; t < active_tieup_cols.length; t++){
              var treadle_id = active_tieup_cols[t];
              if(this.treadling[i] == treadle_id) active_treadle_rows.push(i); 
            }
          }          
          return {wefts: active_treadle_rows, warps: [obj.warp]};
      }

      //this is in the tie-up
      if(obj.frame !== undefined && obj.treadle !== undefined){

          //get all 
          for(var i = 0; i < this.treadling.length; i++){
              if(this.treadling[i] === obj.treadle) active_treadle_rows.push(i); 
          }

          for(var j = 0; j < this.threading.length; j++){
              if(this.threading[j] === obj.frame) active_thread_cols.push(j);
               
          }
          return {wefts: active_treadle_rows, warps: active_thread_cols};
      }

      //this is an action within the treadling
      if(obj.treadle !== undefined && obj.weft !== undefined){


          //whcih frames are associated with this treadle via tie up?
          for(var i = 0; i < this.tieup.length; i++){
            if(this.tieup[i][obj.treadle]){
              active_tieup_rows.push(i);
            }
          }


          //get the cells linked with these frames
          for(var ii = 0; ii < active_tieup_rows.length; ii++){
              for(var j = 0; j < this.threading.length; j++){
                if(this.threading[j] == active_tieup_rows[ii]) active_thread_cols.push(j);
              }
          }


          return {wefts: [obj.weft], warps: active_thread_cols};
      }
       return null;
    }

    inTieupRange(i, j){
      if(j >= 0 && j < this.tieup.length) return true;
      if(i >= 0 && i < this.tieup[0].length) return true;
      return false;
    }

    hasTieup(i, j){
      if(!this.inTieupRange(i, j)) return null;
      else return (this.tieup[i][j]); 

    }

    inThreadingRange(i, j){
      if(j >= 0 && j < this.threading.length) return true;
      if(i >= 0 && i < this.num_frames) return true;
      return false;
    }

    isInFrame(i, j){
      if(!this.inThreadingRange(i, j)) return null;
      else return (this.threading[j] ==i); 

    }

    inTreadlingRange(i, j){
      if(j >= 0 && j < this.treadling.length) return true;
      if(i >= 0 && i < this.num_treadles) return true;
      return false;
    }

    isInTreadle(i, j){
      if(!this.inTreadlingRange(i, j)) return null;
      else return (this.treadling[i] ==j); 

    }


    updateTieup(i, j, val){
        if(!this.inTieupRange(i,j)) return;
        this.tieup[i][j] = val;
    }

    updateThreading(i, j, val){
      var updates = [];
      var frame = this.threading[j];

      if(!this.inThreadingRange(i, j)) return updates;


      //nothing is assigned to this frame
      if(frame == -1){
          if(val) this.threading[j] = i;
          else this.threading[j] = -1;
      }else{
         updates.push({i:frame, j: j, val:false});
      }

      updates.push({i:i, j: j, val:val});

      if(val) this.threading[j] = i;
      else this.threading[j] = -1;
      
      return updates;
    }

    updateTreadling(i, j, val){
      var updates = [];
      var treadle = this.treadling[i];

      if(!this.inTreadlingRange(i, j)) return updates;

      //if this treadle is assigned && the value is true
      if(treadle != -1 && val) updates.push({i:i, j: treadle, val:false});
      updates.push({i:i, j: j, val:val});
      
      if(val) this.treadling[i] = j;
      else this.treadling[i] = -1;

      return updates;

    }


    clearTieupCol(i){
       for(var j = 0; j < this.tieup.length; j++){
            this.tieup[j][i] = false;
        }
    }

      clearTieupRow(i){
       for(var j = 0; j < this.tieup[0].length; j++){
            this.tieup[i][j] = false;
       }
    }
  



    updateUnused(struct:Array<number>, min:number, num:number, type:string){
        console.log("UPDATE UNUSED", type);

        var status = [];
        var zeros = []; 
        var condensed = false;
        var map = [];        //map [new-index] = old-index


        //first check if the frames/treadles are being used or not
        //push unusued frames to zero:
        for(var i = 0; i < num; i++){
          var occurances = countOccurrences(struct, i);
          status[i] = occurances;
          if(occurances === 0) zeros.push(i);
        }
        console.log("status", status);
        console.log("zeros", zeros);
        
        //if all the frames/treadles have assignments- don't do anything
        if(zeros.length == 0) return false;
        
        //push non-zero rows in order to map first
        for(var i = 0; i < num; i++){
          if(countOccurrences(zeros, i) == 0){
            map.push(i);
          }
        }

        //then add zero rows
        for(var i = 0; i < zeros.length; i++){
          map.push(zeros[i]);
        }

        console.log("map", map);

        var swap_happened = false;
        var old_struct = struct.slice();
        var old_tieup = [];
        
        for(var i = 0; i < this.tieup.length; i++){
          old_tieup.push(this.tieup[i].slice());
        }

        //assert (map.length === num);
        
        //reassign the frames/treadles and tieup 
        for(var i = 0; i < map.length; i++){
          var new_ndx = i; 
          var old_ndx = map[i];

          if(new_ndx != old_ndx){

            swap_happened = true;

            console.log(type+" swapped ", old_ndx, "-->", new_ndx);
            console.log(" struct before: ", struct);


            for(var j = 0; j < struct.length; j++){
              
              if(old_struct[j] === old_ndx){ 
                struct[j] = new_ndx;
              }
            }
            console.log(" struct after: ", struct);

             if(type === "threading"){

                for(var j = 0; j < this.tieup[old_ndx].length; j++){
                    this.tieup[new_ndx][j] = old_tieup[old_ndx][j]; 
                }
              }else{
                for(var j = 0; j < this.tieup.length; j++){
                  this.tieup[j][new_ndx] = old_tieup[j][old_ndx];
                }
              }
          }
        }

        console.log(num, min, map, status);
        for(var i = (num-1); i > (min-1); i--){
           
           var old_index = map[i];
           
           console.log("checking frame id", i);
           console.log("value", old_index, status[old_index]);
           
           if(status[old_index] === 0){
              if(type === "threading"){
                this.num_frames--;
                this.tieup.splice(i, 1);

              } else{
                this.num_treadles--;
                for(var j = 0; j < this.tieup.length; j++){
                  this.tieup[j].splice(i, 1);
                }
              }
           }
        }

        return (swap_happened || this.num_frames < num);
  }

}//end class
