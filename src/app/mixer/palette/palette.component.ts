import { Observable, Subscription, fromEvent, from, iif } from 'rxjs';
import { DesignmodesService } from '../../core/provider/designmodes.service';
import { Component, HostListener, ViewContainerRef, Input, ComponentFactoryResolver, ViewChild, OnInit, ViewRef, Output, EventEmitter } from '@angular/core';
import { SubdraftComponent } from './subdraft/subdraft.component';
import { MarqueeComponent } from './marquee/marquee.component';
import { SnackbarComponent } from './snackbar/snackbar.component';
import { Draft } from './../../core/model/draft';
import { Cell } from './../../core/model/cell';
import {MatSnackBar} from '@angular/material/snack-bar';
import { Point, Interlacement, Bounds, DraftMap } from '../../core/model/datatypes';
import { Pattern } from '../../core/model/pattern'; 
import { InkService } from '../../mixer/provider/ink.service';
import {cloneDeep, divide, isBuffer} from 'lodash';
import { LayersService } from '../../mixer/provider/layers.service';
import { Shape } from '../model/shape';
import utilInstance from '../../core/model/util';
import { OperationComponent } from './operation/operation.component';
import { ConnectionComponent } from './connection/connection.component';
import { TreeService } from '../provider/tree.service';
import { FileService, SaveObj } from './../../core/provider/file.service';
import { Timeline } from '../../core/model/timeline';
import { ViewportService } from '../provider/viewport.service';
import { NoteComponent } from './note/note.component';
import { Note, NotesService } from '../../core/provider/notes.service';
import { DraftviewerComponent } from '../../core/draftviewer/draftviewer.component';

@Component({
  selector: 'app-palette',
  templateUrl: './palette.component.html',
  styleUrls: ['./palette.component.scss']
})


export class PaletteComponent implements OnInit{

  /**
   * a reference to the default patterns (used for fill operations)
   * @property {Array<Pattern>}
   */ 
  @Input() patterns: Array<Pattern>;
  @Input() timeline: Timeline;
  @Output() onDesignModeChange: any = new EventEmitter();  

  /**
   * A container that supports the automatic generation and removal of the components inside of it
   */
  @ViewChild('vc', {read: ViewContainerRef, static: true}) vc: ViewContainerRef;

  subdraftSubscriptions: Array<Subscription> = [];
  operationSubscriptions: Array<Subscription> = [];
  connectionSubscriptions: Array<Subscription> = [];
  noteSubscriptions: Array<Subscription> = [];


/**
 * Subscribes to move event after a touch event is started.
 * @property {Subscription}
 */
  moveSubscription: Subscription;

  /**
   * flag to determine how conneection should be drawn
   */
  selecting_connection: boolean = false;


    /**
   * a placeholder to reference a temporary rendering of an union between subdrafts
   * used to preview the changes that will happen if the subdraft is to be dropped at that point
   * @property {SubdraftComponent}
   */
  preview: SubdraftComponent;

  /**
   * a reference to the viewref for the intersection component to ease addign and deleting
   * @property {ViewRef}
   */
  preview_ref: ViewRef;


  /**
   * store teh viewRefs for each note
   */
  note_refs: Array<ViewRef> = [];
  note_components: Array<NoteComponent> = [];
     
  /**
   * holds a reference to the selection component
   * @property {Selection}
   */
  selection = new MarqueeComponent();

  /**
   * holds the data of events drawn on this component (that are not associated with a subdraft)
   * @property {Array<Array<Cell>>}
   */
  scratch_pad: Array<Array<Cell>> = [];

  /**
   * HTML Canvas element that draws the selection and currently cells drawn on this component
   * @property {Canvas}
   */
  canvas: HTMLCanvasElement;
  cx: any;

  /**
   * stores an i and j of the last user selected location within the component
   * @property {Point}
   */
  last: Interlacement;

  /**
   * triggers a class to handle disabling pointerevents when switching modes
   * @property {boolean}
   */
   pointer_events: boolean;

  /**
   * a value to represent the current user defined scale for this component. 
   * @property {number}
   */

   scale: number;


    /**
   * a string to represent the current user defined scale for this component to be used in background grid css. 
   * @property {striing}
   */

  scale_string: string;

  /**
   * links to the z-index to push the canvas to the front or back of view when freehand drawing. 
   */
   canvas_zndx:number = -1;
  
  
  /**
   * stores the bounds of the shape being drawn
   */
   shape_bounds:Bounds;
  
  /**
   * stores the vtx for freehand shapes
   */
   shape_vtxs:Array<Point>;
  

  /**
   * trackable inputs to snackbar
   */
   snack_message:string;
   snack_bounds: Bounds;


   /**
    * a reference to the base size of each cell. Zoom in and out only modifies the view, not this base size.
    */
   default_cell_size: number = 5;
  
  /**
   * Constructs a palette object. The palette supports drawing without components and dynamically
   * creates components from shapes and scribbles on the canvas. 
   * @param dm  a reference to the service containing the current design modes and selections
   * @param tree reference to the objects and relationships within this palette
   * @param inks a reference to the service manaing the available inks
   * @param layers a reference to the sercie managing the view layers (z-indexes) of components
   * @param resolver a reference to the factory component for dynamically generating components
   * @param fs file service for saving and loading files
   * @param _snackBar _snackBar a reference to the snackbar component that shows data on move and select
   * @param viewport reference to the window and palette variables and where the viewer is currently lookin
   * @param notes reference the service that stores all the tagged comments
   */
  constructor(
    private dm: DesignmodesService, 
    private tree: TreeService,
    private inks: InkService, 
    private layers: LayersService, 
    private resolver: ComponentFactoryResolver, 
    private fs: FileService,
    private _snackBar: MatSnackBar,
    private viewport: ViewportService,
    private notes: NotesService) { 
    this.shape_vtxs = [];
    this.pointer_events = true;
  }

/**
 * Called when palette is initailized
 */
  ngOnInit(){
    this.scale = 5; //default set from zoom
    this.scale_string = this.default_cell_size+"px "+this.default_cell_size+"px";
    this.vc.clear();


    
  }

  /**
   * Gets references to view items and adds to them after the view is initialized
   */
   ngAfterViewInit(){
    
    const div:HTMLElement = document.getElementById('scrollable-container');
    this.viewport.set(div.offsetParent.scrollLeft, div.offsetParent.scrollTop,  div.offsetParent.clientWidth,  div.offsetParent.clientHeight);
    
    // const center:Point = this.viewport.setViewportCenter();
    // div.offsetParent.scrollLeft = this.viewport.getTopLeft().x;
    // div.offsetParent.scrollTop = this.viewport.getTopLeft().y;

    this.canvas = <HTMLCanvasElement> document.getElementById("scratch");
    this.cx = this.canvas.getContext("2d");
    
    this.canvas.width = this.viewport.getWidth();
    this.canvas.height = this.viewport.getHeight();

    // this.cx.beginPath();
    // this.cx.rect(20, 20, this.viewport.width-40, this.viewport.height-40);
    // this.cx.stroke();

    this.selection.scale = this.scale;

    this.selection.active = false;
    
    this.designModeChanged();

    this.rescale(this.scale);
  }

  /**
   * unsubscribes to all open subscriptions and clears the view component
   */
  ngOnDestroy(){

    this.unsubscribeFromAll();
    this.vc.clear();
    
  }

  /**
   * the only way to prevent memory leaks is to unsubscribe.
   * since we lose access to tree when a new file is uploaded we must unsubscribe 
   * when any upload action is taking place. If no action takes place, then resubscribe
   */
  unsubscribeFromAll(){
    
    this.subdraftSubscriptions.forEach(element => element.unsubscribe());
    this.operationSubscriptions.forEach(element => element.unsubscribe());
    this.connectionSubscriptions.forEach(element => element.unsubscribe());
    this.noteSubscriptions.forEach(element => element.unsubscribe());
  }

  /**
   * resubscribes to each subscription
   */
  resubscribe(){

    this.tree.getDrafts().forEach(element => {
     this.setSubdraftSubscriptions(element);
    });


    this.tree.getOperations().forEach(element => {
      this.setOperationSubscriptions(element)
    });

    this.tree.getConnections().forEach(element => {
    });

    this.tree.getConnections().forEach(element => {
    });



  }

  /**
   * called when a new file is loaded
   */
   clearComponents(){
    this.unsubscribeFromAll();
    this.vc.clear();
  }

  
/**
 * called when user moves position within viewer
 * @param data 
 */
  handleScroll(position: any){

    this.viewport.setTopLeft(position);
    const div:HTMLElement = document.getElementById('scrollable-container');  
     div.offsetParent.scrollLeft = this.viewport.getTopLeft().x;
     div.offsetParent.scrollTop = this.viewport.getTopLeft().y;
  }

  /**
 * called when user scrolls the winidow
 * @param data 
 */
   handleWindowScroll(data: any){

    const div:HTMLElement = document.getElementById('scrollable-container');
    this.viewport.set(div.offsetParent.scrollLeft, div.offsetParent.scrollTop,  div.offsetParent.clientWidth,  div.offsetParent.clientHeight);
    //update the canvas to this position
  }

  /**
   * removes the view associate with this view ref
   * @param ref 
   */
  removeFromViewContainer(ref: ViewRef){
    const ndx: number = this.vc.indexOf(ref);
    if(ndx != -1) this.vc.remove(ndx);
    else console.log('Error: view ref not found for remvoal');

  }

  /**
   * adds a state to the timeline. This should be called 
   * each time a user performs an action that they should be able to undo/redo
   */
  addTimelineState(){


    const so: string = this.fs.saver.ada(
      'mixer', 
      this.tree.exportDraftsForSaving(),
      [],
      true);

    this.timeline.addMixerHistoryState(so);

  }

  /**
   * this cycles through all subdrafts and calls the download call on any subdrafts
   * who are currently visible. 
   */
  downloadVisibleDraftsAsBmp(){

    const drafts: Array<SubdraftComponent> = this.tree.getDrafts();
    const visible_drafts: Array<SubdraftComponent> = drafts.filter(el => el.draft_visible)
    const functions: Array<Promise<any>> = visible_drafts.map(el => el.saveAsBmp());
    Promise.all(functions).then(el =>
      console.log("Downloaded "+functions.length+" files")
    );

  }
  
  /**
   * this cycles through all subdrafts and calls the download call on any subdrafts
   * who are currently visible. 
   */
   downloadVisibleDraftsAsWif(){

    const drafts: Array<SubdraftComponent> = this.tree.getDrafts();
    const visible_drafts: Array<SubdraftComponent> = drafts.filter(el => el.draft_visible)
    const functions: Array<Promise<any>> = visible_drafts.map(el => el.saveAsWif());
    Promise.all(functions).then(el =>
      console.log("Downloaded "+functions.length+" files")
    );

  }
  


  /**
   * called anytime an operation is added
   * @param name 
   */
  addOperation(name:string){
    const op:OperationComponent = this.createOperation(name);
  }

  /**
   * redraws each operation and subdraft at the new scale, then redraws each of their connections
   * @param scale 
   */
  rescale(scale:number){

    this.scale = scale;

    const zoom_factor: number = this.scale / this.default_cell_size;
    // const palette_div = document.getElementById("palette");
    // palette_div.style.transform = 'scale(' + (scale-4) + ')';

      //   //var dims = this.render.getCellDims("base");
      const container: HTMLElement = document.getElementById('palette');
      container.style.transformOrigin = 'top left';
      container.style.transform = 'scale(' + zoom_factor + ')';
  
     
    const generations: Array<Array<number>> = this.tree.convertTreeToGenerations();

    //these subdrafts are all rendered independely of the canvas and need to indivdiually rescalled. This 
    //essentially rerenders (but does not redraw them) and updates their top/lefts to scaled points
    generations.forEach(generation => {
      generation.forEach(node => {
        const comp = this.tree.getComponent(node);
        if(this.tree.getType(node) != "cxn") comp.rescale(scale);
      })
    });

    this.tree.getConnections().forEach(sd => {
      sd.rescale(scale);
    });

    this.note_components.forEach(el => {
      el.rescale(scale, this.default_cell_size);
    });

  

     if(this.preview !== undefined) this.preview.scale = this.scale;
  }

  
  /**
   * loads the snackbar at the bottom of the screen
   * @param message the message to show on the snack bar
   * @param bounds the bounds of the element that we are showing info aboout
   */
  startSnackBar(message: string, bounds:Bounds){
    this.updateSnackBar(message, bounds);
    this._snackBar.openFromComponent(SnackbarComponent, {
      data: {
        message: this.snack_message,
        bounds: this.snack_bounds,
        scale: this.scale
      }
    });
  }

  /**
   * updates data shown on the snackbar
   * @param message 
   * @param bounds 
   */
  updateSnackBar(message: string, bounds:Bounds){
    this.snack_bounds = bounds;
    this.snack_message = message;
  }

  /**
   * called to close the snackbar
   */
  closeSnackBar(){
    this._snackBar.dismiss();
  }


  /**
   * called when the palette needs to change the design mode, emits output to parent
   * @param name - the mode to switchh to
   */
  changeDesignmode(name: string) {
    this.dm.selectDesignMode(name, 'design_modes');
    const mode = this.dm.getDesignMode(name, 'design_modes');
    this.onDesignModeChange.emit(name);
  }

  // disablePointerEvents(){
  //   this.pointer_events = false;
  // }

  // enablePointerEvents(){
  //   this.pointer_events = true;
  // }

  /**
   * called when a new subdraft is created
   * @param sd 
   */
  setSubdraftSubscriptions(sd: SubdraftComponent){
    this.subdraftSubscriptions.push(sd.onSubdraftDrop.subscribe(this.subdraftDropped.bind(this)));
    this.subdraftSubscriptions.push(sd.onSubdraftMove.subscribe(this.subdraftMoved.bind(this)));
    this.subdraftSubscriptions.push(sd.onSubdraftStart.subscribe(this.subdraftStarted.bind(this)));
    this.subdraftSubscriptions.push(sd.onDeleteCalled.subscribe(this.onDeleteSubdraftCalled.bind(this)));
    this.subdraftSubscriptions.push(sd.onDuplicateCalled.subscribe(this.onDuplicateSubdraftCalled.bind(this)));
    this.subdraftSubscriptions.push(sd.onConnectionStarted.subscribe(this.onConnectionStarted.bind(this)));
    this.subdraftSubscriptions.push(sd.onDesignAction.subscribe(this.onSubdraftAction.bind(this)));
  }

  /**
   * dynamically creates a a note component
   * @returns the created note instance
   */
   createNote():NoteComponent{

    console.log("creating note");
    
    const tl: Point = this.viewport.getTopLeft();
    const factory = this.resolver.resolveComponentFactory(NoteComponent);
    const notecomp = this.vc.createComponent<NoteComponent>(factory);
    const note = this.notes.createBlankNode(utilInstance.resolvePointToAbsoluteNdx(tl, this.scale));
    this.setNoteSubscriptions(notecomp.instance);

    this.note_refs.push(notecomp.hostView);
    this.note_components.push(notecomp.instance);
    notecomp.instance.id = note.id;
    notecomp.instance.scale = this.scale;

    return notecomp.instance;
  }

    /**
   * dynamically creates a a note component
   * @returns the created note instance
   */
    loadNote(note: Note):NoteComponent{

      
      const factory = this.resolver.resolveComponentFactory(NoteComponent);
      const notecomp = this.vc.createComponent<NoteComponent>(factory);
      this.setNoteSubscriptions(notecomp.instance);
      this.note_refs.push(notecomp.hostView);
      this.note_components.push(notecomp.instance);

      notecomp.instance.id = note.id;
      notecomp.instance.scale = this.scale;
  
      return notecomp.instance;
    }

    
    
      /**
   * called when a new operation is added
   * @param op 
   */
  setNoteSubscriptions(note: NoteComponent){
    this.noteSubscriptions.push(note.deleteNote.subscribe(this.deleteNote.bind(this)));
  }

  deleteNote(id: number){
    const ref: ViewRef = this.note_refs[id];
    this.removeFromViewContainer(ref);
    this.note_refs = this.note_refs.filter((el, ndx) => ndx!= id);
    this.note_components = this.note_components.filter((el, ndx) => ndx!= id);
  }



  /**
   * dynamically creates a subdraft component, adds its inputs and event listeners, pushes the subdraft to the list of references
   * @param d a Draft object for this component to contain
   * @returns the created subdraft instance
   */
  createSubDraft(d: Draft):SubdraftComponent{

    console.log("creating subdraft");
    
    const factory = this.resolver.resolveComponentFactory(SubdraftComponent);
    const subdraft = this.vc.createComponent<SubdraftComponent>(factory);
    const id = this.tree.createNode('draft', subdraft.instance, subdraft.hostView);

    this.setSubdraftSubscriptions(subdraft.instance);

    subdraft.instance.draft = d;
    subdraft.instance.id = id;
    subdraft.instance.default_cell = this.default_cell_size;
    subdraft.instance.scale = this.scale;
    subdraft.instance.patterns = this.patterns;
    subdraft.instance.ink = this.inks.getSelected(); //default to the currently selected ink

    return subdraft.instance;
  }


  

  /**
   * loads a subdraft component from data
   * @param d a Draft object for this component to contain
   * @returns the id of the instance created
   */
   loadSubDraft(d: Draft, bounds:Bounds):number{
    console.log("loading subdraft");

    const sd:SubdraftComponent = this.createSubDraft(d);
    sd.bounds = bounds;
    sd.interlacement = utilInstance.resolvePointToAbsoluteNdx(bounds.topleft, this.scale);
    this.viewport.addObj(sd.id, utilInstance.resolvePointToAbsoluteNdx(bounds.topleft, this.scale));
    return sd.id;
  }

  /**
   * called when a new operation is added
   * @param op 
   */
  setOperationSubscriptions(op: OperationComponent){
    this.operationSubscriptions.push(op.onOperationMove.subscribe(this.operationMoved.bind(this)));
    this.operationSubscriptions.push(op.onOperationParamChange.subscribe(this.operationParamChanged.bind(this)));
    this.operationSubscriptions.push(op.deleteOp.subscribe(this.onDeleteOperationCalled.bind(this)));
    this.operationSubscriptions.push(op.duplicateOp.subscribe(this.onDuplicateOpCalled.bind(this)));
    this.subdraftSubscriptions.push(op.onConnectionRemoved.subscribe(this.removeConnection.bind(this)));
    this.subdraftSubscriptions.push(op.onInputAdded.subscribe(this.connectionMade.bind(this)));
  }

  /**
   * creates an operation component
   * @param name the name of the operation this component will perform
   * @returns the OperationComponent created
   */
    createOperation(name: string):OperationComponent{
      const factory = this.resolver.resolveComponentFactory(OperationComponent);
      const op = this.vc.createComponent<OperationComponent>(factory);
      const id = this.tree.createNode('op', op.instance, op.hostView);

      this.setOperationSubscriptions(op.instance);

      op.instance.name = name;
      op.instance.id = id;
      op.instance.zndx = this.layers.createLayer();
      op.instance.scale = this.scale;
      op.instance.default_cell = this.default_cell_size;
      return op.instance;
    }

    /**
   * loads an operation with the information supplied. 
   * @param name the name of the operation this component will perform
   * @params params the input data to be used in this operation
   * @returns the id of the node this has been assigned to
   */
     loadOperation(name: string, params: Array<number>, bounds:Bounds):number{
      
      const op:OperationComponent = this.createOperation(name);
      
      op.loaded_inputs = params;
      op.bounds.topleft = {x: bounds.topleft.x, y: bounds.topleft.y};
      op.bounds.width = bounds.width;
      op.bounds.height = bounds.height;
      op.loaded = true;

      return op.id;
    }

    /**
     * duplicates an operation with the information supplied. 
     * @param name the name of the operation this component will perform
     * @params params the input data to be used in this operation
     * @returns the id of the node this has been assigned to
     */
     duplicateOperation(name: string, params: Array<number>, bounds:Bounds):number{
      
      const op:OperationComponent = this.createOperation(name);
          
          op.loaded_inputs = params;
          op.bounds.topleft = {x: bounds.topleft.x, y: bounds.topleft.y};
          op.bounds.width = bounds.width;
          op.bounds.height = bounds.height;
          op.duplicated = true;
    
          return op.id;
      }


    /**
     * creates a connection component and registers it with the tree
     * @returns the list of all id's connected to the "to" node 
     */
     createConnection(id_from: number, id_to:number):{input_ids: Array<number>, id: number}{

      const factory = this.resolver.resolveComponentFactory(ConnectionComponent);
      const cxn = this.vc.createComponent<ConnectionComponent>(factory);
      const id = this.tree.createNode('cxn', cxn.instance, cxn.hostView);
      const to_input_ids: Array<number> =  this.tree.addConnection(id_from, id_to, id);
      
      cxn.instance.id = id;
      cxn.instance.scale = this.scale;
      cxn.instance.from = id_from;
      cxn.instance.to = id_to;


      to_input_ids.forEach((el, ndx) => {
        const sd: SubdraftComponent = <SubdraftComponent> this.tree.getComponent(el);
        sd.active_connection_order = ndx+1;
      });

      return {input_ids: to_input_ids, id: id};
    }




  /**
   * called from upload or import events
   * @param d 
   */
  addSubdraftFromDraft(d: Draft){
    console.log("adding from uplaod", d);
    const sd: SubdraftComponent = this.createSubDraft(d);
    sd.setPosition({x: this.viewport.getTopLeft().x, y: this.viewport.getTopLeft().y});
    
  }

  /**
   * a subdraft can only have an operation for a parent
   * removes the subdraft sent to the function
   * updates the tree view_id's in response
   * @param id {number}  

   */
  removeSubdraft(id: number){

    console.log("removing subdraft id", id);

    const parent_id = this.tree.getSubdraftParent(id);

    //remove the node but get all the ops before it is removed 
    const ref:ViewRef = this.tree.getViewRef(id);
   // const inputs:Array<number> = this.tree.getNonCxnInputs(id);


    //inputs will always be of type op
    // inputs.forEach(input => {
    //   console.log("inputs = ", this.tree.getType(input));
    //   if(this.tree.getType(input) == 'draft'){
    //     const comp = <SubdraftComponent> this.tree.getComponent(input);
    //     comp.has_active_connection = false;
    //     comp.active_connection_order = 0;
    //   }
    // })

    const downstream_ops:Array<number> = this.tree.getDownstreamOperations(id);
    this.tree.removeNode(id);
 
    const old_cxns:Array<number> = this.tree.getUnusuedConnections();
    console.log("unused connection cxn ", old_cxns);
    old_cxns.forEach(cxn => {
      const cxn_view_ref = this.tree.getViewRef(cxn);
      this.removeFromViewContainer(cxn_view_ref);
      this.tree.removeNode(cxn);
    });    

    //calls manually here so that the affected branches can be pinged before the node is deleted 
    this.recalculateDownstreamDrafts(downstream_ops);
    this.removeFromViewContainer(ref);
    this.viewport.removeObj(id);




    // if the parent op has no children, remove the operation parent as well
    if(parent_id != -1 && !this.tree.isParent(parent_id)){
      this.removeOperation(parent_id);
    }

  }

  /**
   * this function will
   * 1. delete the associated output subdrafts
   * 2. recompue downsteam operations
   * 3. delete all input + output connections
   * @param id 
   */
  removeOperation(id:number){

    //remove the node but get alll the ops before it is removed 
    const ref:ViewRef = this.tree.getViewRef(id);
    const outputs:Array<number> = this.tree.getNonCxnOutputs(id);

    outputs.forEach(output => {
      if(this.tree.getType(output) == 'draft'){
        const comp = <SubdraftComponent> this.tree.getComponent(output);
        comp.has_active_connection = false;
        comp.active_connection_order = 0;
        comp.parent_id = -1;
      }
    })

    const downstream_ops:Array<number> = this.tree.getDownstreamOperations(id);
    this.tree.removeNode(id);



    const old_cxns:Array<number> = this.tree.getUnusuedConnections();
    old_cxns.forEach(cxn => {
      const cxn_view_ref = this.tree.getViewRef(cxn);
      this.removeFromViewContainer(cxn_view_ref);
      this.tree.removeNode(cxn);
    });    



    //calls manually here so that the affected branches can be pinged before the node is deleted 
    this.recalculateDownstreamDrafts(downstream_ops);
    this.removeFromViewContainer(ref);
    this.viewport.removeObj(id);

  }

    /**
   * dynamically creates a subdraft component with specific requirements of the intersection, adds its inputs and event listeners, pushes the subdraft to the list of references
   * @param d a Draft object for this component to contain
   * @returns the created subdraft instance
   */
  createAndSetPreview(d: Draft){
      const factory = this.resolver.resolveComponentFactory(SubdraftComponent);
      const subdraft = this.vc.createComponent<SubdraftComponent>(factory);
      //note, the preview is not added to the tree, as it will only be added if it eventually accepted by droppings
      subdraft.instance.draft = d;
      subdraft.instance.id = -1;
      subdraft.instance.default_cell = this.default_cell_size;
      subdraft.instance.scale = this.scale;
      subdraft.instance.patterns = this.patterns;
      subdraft.instance.ink = this.inks.getSelected(); //default to the currently selected ink


      subdraft.instance.setAsPreview();
      subdraft.instance.disableDrag();

      this.preview_ref = subdraft.hostView;
      this.preview = subdraft.instance;
      this.preview.scale = this.scale;
    }

  hasPreview():boolean{
      if(this.preview_ref === undefined) return false;
      return true;
  }

  /**
   * destorys the 
   * @param d a Draft object for this component to contain
   * @returns the created subdraft instance
   */
  removePreview(){
      const ndx = this.vc.indexOf(this.preview_ref);
      this.vc.remove(ndx);
      this.preview_ref = undefined;
      this.preview = undefined;
  }

  /**
   * Called from mixer when it receives a change from the design mode tool or keyboard press
   * triggers view mode changes required for this mode
   */
  public designModeChanged(){

    console.log('design mode changed', this.dm.getSelectedDesignMode('design_modes'));

    if(this.dm.getDesignMode('move', 'design_modes').selected){
      console.log('unfreezing');
      this.unfreezePaletteObjects();

    }else{
      this.freezePaletteObjects();
    }

    if(this.dm.getDesignMode('draw', 'design_modes').selected || this.dm.getDesignMode('shape',  'design_modes').selected){
      this.rescale(Math.ceil(this.scale));
    }

    // if(this.design_modes.isSelected('operation')){
    //   this.disablePointerEvents();
    // }else{
    //   this.enablePointerEvents();
    // }


  }

  /**
   * specifically removes the subscription from the move event
   */
   private removeSubscription() {    
    if (this.moveSubscription) {
      this.moveSubscription.unsubscribe();
    }
  }

  /**
   * draws the selection atop the view
   * todo: update this to account for scroll
   * @param ndx 
   */
  private drawSelection(ndx: Interlacement){


    this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const bounds ={
      left: this.selection.start.j*this.scale,
      top: this.selection.start.i*this.scale,
      right: ndx.j *this.scale,
      bottom: ndx.i*this.scale
    };

    //will draw on outside of selection
    this.cx.beginPath();
    this.cx.strokeStyle = "#ff4081";
    this.cx.lineWidth = 1;
    this.cx.setLineDash([this.scale, 2]);
    this.cx.strokeRect(bounds.left - this.viewport.getTopLeft().x, bounds.top  - this.viewport.getTopLeft().y, bounds.right-bounds.left, bounds.bottom-bounds.top);
      
  }

  /**
   * Takes an absolute index and returns it to an index relative to the viewport. 
   * @param abs 
   * @returns 
   */
  private getRelativeInterlacement(abs: Interlacement) : Interlacement {
    const i_offset: number = Math.floor(this.viewport.getTopLeft().y / this.scale);
    const j_offset: number = Math.floor(this.viewport.getTopLeft().x / this.scale);
    const rel: Interlacement = {
      i: abs.i - i_offset,
      j: abs.j - j_offset,
      si: -1
    }

    return rel;
  }


  /**
   * sets the value of the scratchpad cell at ndx
   * checks for self interselcting 
   * @param ndx (i,j)
   */
  private setCell(ndx: Interlacement){

    const rel: Interlacement = this.getRelativeInterlacement(ndx);
    const c: Cell = this.scratch_pad[rel.i][rel.j];

    const selected: string = this.dm.getSelectedDesignMode('draw_modes').value;

    switch(selected){
      case 'toggle':
        const cur: boolean = c.getHeddle();
        if(cur == null)  c.setHeddle(true);
        else c.setHeddle(!cur);
        break;
      case 'down':
        c.setHeddle(false);
        break;
      case 'up':
        c.setHeddle(true);
      break;
      case 'unset':
        c.setHeddle(null);
      break;
    }


    //use the code below to use past scratchpad values, but this seems wrong
    // console.log(c);
    // const val: boolean = c.isSet(); //check for a previous value
    // c.setHeddle(true);

    // if(val){
    //   const newval:boolean = this.computeCellValue(this.inks.getSelected(), c, val);
    //   console.log("setting to", newval);
    //   c.setHeddle(newval);
    // } 
  }

  /**
   * called by drawcell. Draws on screen based on the current ink
   * @param ink 
   * @param over 
   * @param under 
   * @returns 
   */
  private computeCellColor(ink: string, over: Cell, under: boolean): string{

    const res: boolean = this.computeCellValue(ink, over, under);
    if(ink === 'unset' && res == true) return "#cccccc"; 
    if(res ===null) return "#fafafa";
    if(res) return "#000000";
    return "#ffffff";      
  }

  /**
   * applies the filter betetween over and under and returns the result
   * @param ink the ink with which to compute the transition
   * @param over the value of the primary (top) cell
   * @param under the value of the intersecting (bottom) cell 
   * @returns 
   */
  private computeCellValue(ink: string, over: Cell, under: boolean): boolean{
    
    let res: boolean = utilInstance.computeFilter(ink, over.getHeddle(), under);
    return res;   
  }

  /**
   * called when creating a subdraft from the drawing on the screen. Computes the resulting value based on
   * all intersections with the drawing
   * @param ndx the i,j location of the cell we are checking
   * @param ink the currently selected ink
   * @param over the Cell we are checking against
   * @returns true/false or null
   */
  private getScratchpadProduct(ndx: Interlacement, ink: string, over: Cell): boolean{
    
    switch(ink){
      case 'neq':
      case 'and':
      case 'or':

        const p = {x: ndx.j * this.scale, y: ndx.i * this.scale};
        const isect = this.getIntersectingSubdraftsForPoint(p);
  
        if(isect.length > 0){
          const prev: boolean = isect[0].resolveToValue(p);
          return this.computeCellValue(ink, over, prev);
        }else{
          return this.computeCellValue(ink, over, null);
        }
      break;

      default: 
        return this.computeCellValue(ink, over, null);
      break;
    }
   return null; 
  }
 

  /**
   * draw the cell at position ndx
   * @param ndx (i,j)
   */
  private drawCell(ndx: Interlacement){

    const rel: Interlacement = this.getRelativeInterlacement(ndx);
    const c: Cell = this.scratch_pad[rel.i][rel.j];
    this.cx.fillStyle = "#cccccc";
  
    const selected_ink:string = this.inks.getSelected();

    switch(selected_ink){
      case 'neq':
      case 'and':
      case 'or':

        const p = {x: ndx.j * this.scale, y: ndx.i * this.scale};
        const isect = this.getIntersectingSubdraftsForPoint(p);

        if(isect.length > 0){
          const prev: boolean = isect[0].resolveToValue(p);
          this.cx.fillStyle = this.computeCellColor(selected_ink, c, prev);
        }else{
          this.cx.fillStyle =  this.computeCellColor(selected_ink, c, null);;
        }
      break;

      default: 
        this.cx.fillStyle = this.computeCellColor(selected_ink, c, null);
      break;

    }

      this.cx.fillRect(rel.j*this.scale, rel.i*this.scale, this.scale, this.scale);      
  }

  /**
   * Deletes the subdraft that called this function.
   */
    onDeleteSubdraftCalled(obj: any){
      
      console.log("deleting "+obj.id);
      if(obj === null) return;
      this.removeSubdraft(obj.id);
      this.addTimelineState();
   }

     /**
   * Deletes the subdraft that called this function.
   */
      onDeleteOperationCalled(obj: any){
      
        console.log("deleting op "+obj.id);
        if(obj === null) return;
        this.removeOperation(obj.id);
        this.addTimelineState();
     }

   /**
   * Duplicates the operation that called this function.
   */
    onDuplicateOpCalled(obj: any){
      console.log("duplicating "+obj.id);
      if(obj === null) return;

      const op = <OperationComponent> this.tree.getComponent(obj.id);
      const params = [];
      op.op_inputs.forEach((input,ndx) => {
       params.push(input.value);
      });

      const new_bounds = {
        topleft: {x: op.bounds.topleft.x + op.bounds.width + this.scale * 2, y: op.bounds.topleft.y},
        width: op.bounds.width,
        height: op.bounds.height
      }

      const id: number = this.duplicateOperation(op.name, params, new_bounds);
      const new_op = <OperationComponent> this.tree.getComponent(id);

      //this.operationParamChanged({id: id});
     // this.addTimelineState();
 }





     /**
   * Deletes the subdraft that called this function.
   */
    onDuplicateSubdraftCalled(obj: any){
        console.log("duplicating "+obj.id);
        if(obj === null) return;

        const sd = <SubdraftComponent> this.tree.getComponent(obj.id);

        
        const new_sd:SubdraftComponent = this.createSubDraft(new Draft({wefts: sd.draft.wefts, warps: sd.draft.warps, pattern: sd.draft.pattern}));
        new_sd.setComponentSize(sd.bounds.width, sd.bounds.height);
        new_sd.setPosition({
          x: sd.bounds.topleft.x + sd.bounds.width + this.scale *2, 
          y: sd.bounds.topleft.y});
        new_sd.drawDraft();

        const interlacement = utilInstance.resolvePointToAbsoluteNdx(new_sd.bounds.topleft, this.scale); 
        this.viewport.addObj(new_sd.id, interlacement);
        this.addTimelineState();
   }

  /**
   * A mouse event, originated in a subdraft, has been started
   * checkes the design mode and handles the event as required
   * @param obj contains the id of the moving subdraft
   */
  subdraftStarted(obj: any){
    if(obj === null) return;

    if(this.dm.isSelected("move",  'design_modes')){
  
      //get the reference to the draft that's moving
      const moving = <SubdraftComponent> this.tree.getComponent(obj.id);
      
      if(moving === null) return; 


      this.startSnackBar("Using Ink: "+moving.ink, moving.bounds);
      
      const isect:Array<SubdraftComponent> = this.getIntersectingSubdrafts(moving);

      if(isect.length == 0) return;
      
      const bounds: any = utilInstance.getCombinedBounds(moving, isect);
      const temp: Draft = this.getCombinedDraft(bounds, moving, isect);
      this.createAndSetPreview(temp);
      this.preview.drawDraft();
      this.preview.setPosition(bounds.topleft);

    }else if(this.dm.isSelected("marquee",  'design_modes')){
      this.selectionStarted();
    }else if(this.dm.isSelected("draw",  'design_modes')){
      this.drawStarted();
    }

 }

 /**
  * triggers a mode that allows mouse-mouse to be followed by a line.
  * todo; add code that holds the point on scroll
  * @param obj - contains event, id of component who called
  */
 onConnectionStarted(obj: any){

  const valid = this.tree.setOpenConnection(obj.id);
  if(!valid) return;

  this.changeDesignmode('operation');
  this.selecting_connection = true;

  const sd: SubdraftComponent = <SubdraftComponent> this.tree.getComponent(obj.id);
  
  const adj: Point = {x: sd.bounds.topleft.x - this.viewport.getTopLeft().x, y: (sd.bounds.topleft.y+sd.bounds.height) - this.viewport.getTopLeft().y}

  this.unfreezePaletteObjects();
  //this.setDraftsConnectable(this.connection_op_id);

  this.shape_bounds = {
    topleft: adj,
    width: this.scale,
    height: this.scale
  };

  this.startSnackBar("Click an empty space on the palette to stop selecting", this.shape_bounds);

 }



 /**
 * adds a connector flag to any subdrafts that we are allowed to connect to from this operation
 */
  // setDraftsConnectable(op_id: number){
  //   const nodes: Array<SubdraftComponent> = this.tree.getDrafts();
  //   const op: OperationComponent = <OperationComponent> this.tree.getComponent(op_id);
  //   const inputs: Array<number> = this.tree.getInputs(op_id);
  //   if(inputs.length >= op.maxInputs()){
  //     nodes.forEach(el => {
  //       el.unsetConnectable();

  //       //now unset the ones that are already assigned to other ops
  //       const connections: Array<number> = this.tree.getNonCxnOutputs(el.id);
  //       const op_ndx: number = connections.findIndex(id => (id === op_id));
  //       //if it had connections and the connection was not this operation, unset it
  //       if(op_ndx !== -1){
  //         el.setConnectable();
  //       }    
  //     });
  //   }else{

  //     nodes.forEach(el => {

  //       //look upstream to see if this operation is linked in any way to this op
  //       const upstream: Array<number> = this.tree.getUpstreamOperations(el.id);
  //       const ndx: number = upstream.findIndex(i => i === op_id);
  //       if(ndx === -1) el.setConnectable();
  
  //       //now unset the ones that are already assigned to other ops
  //       const connections: Array<number> = this.tree.getOutputs(el.id);
  //       const ops: Array<number> = connections.map(cxn => this.tree.getConnectionOutput(cxn));
  //       const op_ndx: number = ops.findIndex(op => (op === op_id));
  //       //if it had connections and the connection was not this operation, unset it
  //       if(ops.length > 0 && op_ndx === -1){
  //         el.unsetConnectable();
  //       }    
  
  //     });
  //   }

  //   const ops: Array<OperationComponent> = this.tree.getOperations();
  //   ops.forEach(op => {
  //     if(op.id != op_id) op.active_connection = true;
  //   });
   
  //  }

    /**
 * disables selection and pointer events on all
 */
  // unsetDraftsConnectable(){
  //   const nodes: Array<SubdraftComponent> = this.tree.getDrafts();
  //   nodes.forEach(el => {
  //     el.unsetConnectable();
  //   });

  //   const ops: Array<OperationComponent> = this.tree.getOperations();
  //   ops.forEach(op => {
  //     op.active_connection = false;
  //   });

  //  }

/**
 * disables selection and pointer events on all
 */
 freezePaletteObjects(){
  const nodes: Array<any> = this.tree.getComponents();
  nodes.forEach(el => {
    el.disableDrag();
  });
 }

 /**
 * unfreezes all palette objects (except connections)
 */
  unfreezePaletteObjects(){
    const nodes: Array<any> = this.tree.getComponents();
    nodes.forEach(el => {
      if(el.type != 'cxn'){
        el.enableDrag();
      } 
    });
   }
  



 /**
   * draws when a user is using the mouse to identify an input to a component
   * @param mouse the absolute position of the mouse on screen
   * @param shift boolean representing if shift is pressed as well 
   */
connectionDragged(mouse: Point, shift: boolean){

  const adj: Point = {x: mouse.x - this.viewport.getTopLeft().x, y: mouse.y - this.viewport.getTopLeft().y}


  this.shape_bounds.width =  (adj.x - this.shape_bounds.topleft.x);
  this.shape_bounds.height =  (adj.y - this.shape_bounds.topleft.y);

  if(shift){

  }

  this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.cx.beginPath();
  this.cx.fillStyle = "#ff4081";
  this.cx.strokeStyle = "#ff4081";
  //  this.cx.fillStyle = "#0000ff";
  //  this.cx.strokeStyle = "#0000ff";
  this.cx.setLineDash([this.scale, 2]);
  this.cx.lineWidth = 2;


  this.cx.moveTo(this.shape_bounds.topleft.x+this.scale, this.shape_bounds.topleft.y+this.scale);
  this.cx.lineTo(this.shape_bounds.topleft.x + this.shape_bounds.width, this.shape_bounds.topleft.y + this.shape_bounds.height);
  this.cx.stroke();
 

}


/**
 * resets the view when a connection event ends
 */
 processConnectionEnd(){
  this.closeSnackBar();
  this.selecting_connection = false;
  this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.changeDesignmode('move');

  if(!this.tree.hasOpenConnection()) return;

  
  const sd: SubdraftComponent = this.tree.getOpenConnection();
  sd.connectionEnded();
  this.tree.unsetOpenConnection();
} 

/**
 * given a node id, calculate any drafts that take place "downstream" from this draft
 * @param id 
 */
recalculateDownstreamDrafts(downstream_ops:Array<number>){
  //recalculate downstream drafts
  downstream_ops.forEach(op => {
    
    this.performOp(op);

  });
}


 performOp(op_id:number){
  
  const op:OperationComponent = <OperationComponent>this.tree.getComponent(op_id);

  const inputs: Array<number> =  this.tree.getNonCxnInputs(op_id);


  const input_drafts: Array<Draft> = inputs.map(input => {
    const  sd:SubdraftComponent = <SubdraftComponent> this.tree.getNode(input).component;
    return sd.draft;
   });

   op.perform(input_drafts)
   .then(draft_map =>  {
    const leftoffset: Point = {x: op.bounds.topleft.x, y: op.bounds.topleft.y};  
  
    console.log(draft_map);

    draft_map.forEach((el, ndx) => {
      let sd:SubdraftComponent = null;
  
      if(el.component_id >= 0){
         sd = <SubdraftComponent> this.tree.getComponent(el.component_id);
         sd.setNewDraft(el.draft);
         leftoffset.x = sd.bounds.topleft.x + sd.bounds.width + this.scale * 2;
      }else{
        sd = this.createSubDraft(el. draft);
        op.addOutput({component_id: sd.id, draft:el.draft});
        sd.setPosition({x: leftoffset.x+(el.draft.warps+1)*ndx*this.scale, y: leftoffset.y + op.bounds.height});
        sd.setComponentSize(el.draft.warps * this.scale, el.draft.wefts * this.scale);
        sd.setParent(op.id);
        const interlacement = utilInstance.resolvePointToAbsoluteNdx(sd.bounds.topleft, this.scale); 
        this.viewport.addObj(sd.id, interlacement);
        this.createConnection(op.id, sd.id);
        this.tree.setSubdraftParent(sd.id, op.id);
        
      }
  
      op.setWidth(sd.bounds.width);
      sd.drawDraft();
    })
   })
   .catch(e => console.log('error on op.perform', e))
}

/**
 * emitted from operation when it receives a hit on its connection button, the id refers to the operation id
 */
connectionMade(id:number){

  //this is defined in the order that the line was drawn
  const op:OperationComponent = <OperationComponent>this.tree.getComponent(id);
  this.createConnection(this.tree.getOpenConnection().id, id);
  this.performOp(id);
  const ds: Array<number> = this.tree.getDownstreamOperations(id);
  this.recalculateDownstreamDrafts(ds);
  this.addTimelineState();

  this.processConnectionEnd();

}

/**
 * emitted from subdraft when it receives a hit on its connection button but already 
 * had something assigned there
 * @param id the subdraft id that called the function
 */
 removeConnection(obj: {from: number, to: number}){


  const cxn:number = this.tree.getConnection(obj.from, obj.to);
  if(cxn == -1){
    console.error("no connection found", obj);
    return;
  } 

  console.log("removing connection ", obj, "connection id=", cxn);
  
  const downstream:Array<number> = this.tree.getDownstreamOperations(cxn);
  // const inputs_to_update: Array<number> = this.tree.getNonCxnInputs(obj.to);
  // const from_comp: any = this.tree.getComponent(obj.from);
  // const from_order_id = from_comp.active_connection_order;
  
  // //upddate the assignment order on input subdrafts
  // inputs_to_update.forEach((el) => {
  //   const comp: any = this.tree.getComponent(el);
  //   if(comp.active_connection_order == from_order_id) comp.active_connection_order = 0;
  //   if(comp.active_connection_order > from_order_id) comp.active_connection_order--;
  // });

  const view_ref = this.tree.getViewRef(cxn);
  this.removeFromViewContainer(view_ref);
  this.tree.removeNode(cxn);

  const to_delete:Array<number> = this.tree.getUnusuedConnections();

  if(to_delete.length > 0) console.log("Error: Removing Connection triggered other deletions");

  //this list has to be calculated before the node is deleted, and udpated after
  this.recalculateDownstreamDrafts(downstream);
  this.processConnectionEnd();
  this.addTimelineState();


}

 

 selectionStarted(){

  this.selection.start = this.last;
  this.selection.active = true;
  this.startSnackBar("Select Drafts to Join", this.selection.bounds);
 }

 /**
 * brings the base canvas to view and begins to render the
 * @param mouse the absolute position of the mouse on screen
 */
shapeStarted(mouse: Point){

  const rel:Point = {
    x: mouse.x - this.viewport.getTopLeft().x,
    y: mouse.y - this.viewport.getTopLeft().y
  }
  
  this.shape_bounds = {
    topleft: rel,
    width: this.scale,
    height: this.scale
  };


  this.shape_vtxs = [];
  this.canvas_zndx = this.layers.createLayer(); //bring this canvas forward
  this.cx.fillStyle = "#ff4081";
  this.cx.fillRect( this.shape_bounds.topleft.x, this.shape_bounds.topleft.y, this.shape_bounds.width,this.shape_bounds.height);
  
  if(this.dm.isSelected('free', 'shapes')){
    this.startSnackBar("CTRL+Click to end drawing", this.shape_bounds);
  }else{
    this.startSnackBar("Press SHIFT while dragging to constrain shape", this.shape_bounds);
  }
 

}

  /**
   * resizes and redraws the shape between the the current mouse and where the shape started
   * @param mouse the absolute position of the mouse on screen
   */
shapeDragged(mouse: Point, shift: boolean){

  const rel:Point = {
    x: mouse.x - this.viewport.getTopLeft().x,
    y: mouse.y - this.viewport.getTopLeft().y
  }

  this.shape_bounds.width =  (rel.x - this.shape_bounds.topleft.x);
  this.shape_bounds.height =  (rel.y - this.shape_bounds.topleft.y);

  if(shift){
    const max: number = Math.max(this.shape_bounds.width, this.shape_bounds.height);
    
    //allow lines to snap to coords
    if(this.dm.isSelected('line', 'shapes')){
        if(Math.abs(this.shape_bounds.width) < Math.abs(this.shape_bounds.height/2)){
          this.shape_bounds.height = max;
          this.shape_bounds.width = this.scale;
        }else if(Math.abs(this.shape_bounds.height) < Math.abs(this.shape_bounds.width/2)){
          this.shape_bounds.width = max;
          this.shape_bounds.height = this.scale;
        }else{
          this.shape_bounds.width = max;
          this.shape_bounds.height = max;  
        }
        
    }else{
      this.shape_bounds.width = max;
      this.shape_bounds.height = max;    
  
    }
  }

  this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.cx.beginPath();
  this.cx.fillStyle = "#ff4081";
  this.cx.strokeStyle = "#ff4081";
  this.cx.setLineDash([]);
  this.cx.lineWidth = this.scale;

  if(this.dm.isSelected('line', 'shapes')){
    this.cx.moveTo(this.shape_bounds.topleft.x+this.scale, this.shape_bounds.topleft.y+this.scale);
    this.cx.lineTo(this.shape_bounds.topleft.x + this.shape_bounds.width, this.shape_bounds.topleft.y + this.shape_bounds.height);
    this.cx.stroke();
  }else if(this.dm.isSelected('fill_circle','shapes')){
    this.shape_bounds.width = Math.abs(this.shape_bounds.width);
    this.shape_bounds.height = Math.abs(this.shape_bounds.height);
    this.cx.ellipse(this.shape_bounds.topleft.x, this.shape_bounds.topleft.y, this.shape_bounds.width, this.shape_bounds.height, 2 * Math.PI, 0,  this.shape_bounds.height/2);
    this.cx.fill();
  }else if(this.dm.isSelected('stroke_circle','shapes')){
    this.cx.ellipse(this.shape_bounds.topleft.x, this.shape_bounds.topleft.y, this.shape_bounds.width, this.shape_bounds.height, 2 * Math.PI, 0,  this.shape_bounds.height/2);
    this.cx.stroke();
  }else if(this.dm.isSelected('fill_rect','shapes')){
    this.cx.fillRect(this.shape_bounds.topleft.x, this.shape_bounds.topleft.y,this.shape_bounds.width,this.shape_bounds.height);
  
  }else if(this.dm.isSelected('stroke_rect','shapes')){
    this.cx.strokeRect(this.shape_bounds.topleft.x + this.scale, this.shape_bounds.topleft.y+ this.scale,this.shape_bounds.width- this.scale,this.shape_bounds.height-this.scale);

  }else{

    if(this.shape_vtxs.length > 1){
      this.cx.moveTo(this.shape_vtxs[0].x, this.shape_vtxs[0].y);

      for(let i = 1; i < this.shape_vtxs.length; i++){
        this.cx.lineTo(this.shape_vtxs[i].x, this.shape_vtxs[i].y);
        //this.cx.moveTo(this.shape_vtxs[i].x, this.shape_vtxs[i].y);
      }

    }else{
      this.cx.moveTo(this.shape_bounds.topleft.x, this.shape_bounds.topleft.y);
    }

    this.cx.lineTo(this.shape_bounds.topleft.x + this.shape_bounds.width, this.shape_bounds.topleft.y + this.shape_bounds.height);
    this.cx.stroke();
    this.cx.fill();
    
  }

  if(this.dm.isSelected('free', 'shapes')){
    this.updateSnackBar("CTRL+click to end drawing", this.shape_bounds);
  }else{
    this.updateSnackBar("Press SHIFT to contstrain shape", this.shape_bounds);
  }
}

/**
 * converts the shape on screen to a component
 */
processShapeEnd(){

  this.closeSnackBar();

  //if circle, the topleft functoins as the center and the bounsd need to expand to fit the entire shape 
  if(this.dm.isSelected('fill_circle', 'shapes') || this.dm.isSelected('stroke_circle', 'shapes')){
    this.shape_bounds.topleft.x -=  this.shape_bounds.width;
    this.shape_bounds.topleft.y -=  this.shape_bounds.height;
    this.shape_bounds.width *=2;
    this.shape_bounds.height *= 2;
  }else if(this.dm.isSelected('free','shapes')){
    
    if(this.shape_vtxs.length === 0) return;
      //default to current segment
    let top = this.shape_bounds.topleft.y;
    let left = this.shape_bounds.topleft.x;
    let bottom = this.shape_bounds.topleft.y +this.shape_bounds.height;
    let right = this.shape_bounds.topleft.x +this.shape_bounds.width;
    
    //iteraate through the poitns and find the leftmost and topmost 
    for(let i = 1; i < this.shape_vtxs.length; i++ ){
        if(this.shape_vtxs[i].y < top) top = this.shape_vtxs[i].y;
        if(this.shape_vtxs[i].x < left) left = this.shape_vtxs[i].x;
        if(this.shape_vtxs[i].y > bottom) bottom = this.shape_vtxs[i].y;
        if(this.shape_vtxs[i].x > right) right = this.shape_vtxs[i].x;
    }

    this.shape_bounds.topleft = {x: left, y: top};
    this.shape_bounds.width = right - left;
    this.shape_bounds.height = bottom - top;

    this.shape_vtxs = [];
    
  }else{
    if( this.shape_bounds.width < 0){
      this.shape_bounds.width = Math.abs(this.shape_bounds.width);
      this.shape_bounds.topleft.x-= this.shape_bounds.width
    }  

    if( this.shape_bounds.height < 0){
      this.shape_bounds.height = Math.abs(this.shape_bounds.height);
      this.shape_bounds.topleft.y-= this.shape_bounds.height
    }  
  }

  const shape: Shape = new Shape(this.canvas, this.shape_bounds, this.scale); 
  //const img_data = shape.getImageData();
  // this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  // this.cx.putImageData(img_data, 0, 0);
  const pattern: Array<Array<Cell>> = shape.getDraft();

  const wefts: number = pattern.length;
  if(wefts <= 0) return;
  const warps: number = pattern[0].length;

  this.shape_bounds.topleft.x += this.viewport.getTopLeft().x;
  this.shape_bounds.topleft.y += this.viewport.getTopLeft().y;
  

  const sd:SubdraftComponent = this.createSubDraft(new Draft({wefts: wefts,  warps: warps, pattern: pattern}));
  sd.setPosition(this.shape_bounds.topleft);
  sd.setComponentSize(this.shape_bounds.width, this.shape_bounds.height);
  sd.disableDrag();


  const interlacement = utilInstance.resolvePointToAbsoluteNdx(sd.bounds.topleft, this.scale); 
  this.viewport.addObj(sd.id, interlacement);
  this.addTimelineState();

  
}

/**
 * clears the scratchpad for the new drawing event
 */
drawStarted(){


  this.canvas_zndx = this.layers.createLayer(); //bring this canvas forward
  
  this.scratch_pad = [];
  for(let i = 0; i < this.canvas.height; i+=this.scale ){
      const row = [];
      for(let j = 0; j< this.canvas.width; j+=this.scale ){
          row.push(new Cell(null));
      }
    this.scratch_pad.push(row);
    }

    this.startSnackBar("Drag to Draw", null);
  }


  /**
   * gets the bounds of a drawing on the scratchpad, a drawing is represented by set cells
   * @returns an object representing the bounds in the format of i, j (the row, column index of the pad)
   */
  getScratchPadBounds(): Array<Interlacement>{
    let bottom: number = 0;
    let right: number = 0;
    let top: number = this.scratch_pad.length-1;
    let left: number = this.scratch_pad[0].length-1;

    for(let i = 0; i < this.scratch_pad.length; i++ ){
      for(let j = 0; j<  this.scratch_pad[0].length; j++){
        if((this.scratch_pad[i][j].isSet())){
          if(i < top) top = i;
          if(j < left) left = j;
          if(i > bottom) bottom = i;
          if(j > right) right = j;
        } 
      }
    }

    return [{i: top, j: left, si: -1}, {i: bottom, j: right, si: -1}];

  }

  /**
   * handles checks and actions to take when drawing event ends
   * gets the boudary of drawn segment and creates a subdraft containing that drawing
   * if the drawing sits on top of an existing subdraft, merge the drawing into that subdraft (extending the original if neccessary)
   * @returns 
   */
  processDrawingEnd(){

    this.canvas_zndx = -1;

    if(this.scratch_pad === undefined) return;
    if(this.scratch_pad[0] === undefined) return;
    
    const corners: Array<Interlacement> = this.getScratchPadBounds();
    const warps = corners[1].j - corners[0].j + 1;
    const wefts = corners[1].i - corners[0].i + 1;

  
    //there must be at least one cell selected
    if(warps < 1 || wefts < 1){
      this.scratch_pad = undefined;
      return;
    } 

    //if this drawing does not intersect with any existing subdrafts, 
    const sd:SubdraftComponent = this.createSubDraft(new Draft({wefts: wefts,  warps: warps}));
    const pos = {
      topleft: {x: this.viewport.getTopLeft().x + (corners[0].j * this.scale), y: this.viewport.getTopLeft().y + (corners[0].i * this.scale)},
      width: warps * this.scale,
      height: wefts * this.scale
    }

    sd.setPosition(pos.topleft);
    sd.setComponentSize(pos.width, pos.height);
    sd.disableDrag();
    const interlacement = utilInstance.resolvePointToAbsoluteNdx(sd.bounds.topleft, this.scale);
    this.viewport.addObj(sd.id, interlacement);

    for(let i = 0; i < sd.draft.wefts; i++ ){
      for(let j = 0; j< sd.draft.warps; j++){
        const c = this.scratch_pad[corners[0].i+i][corners[0].j+j];
        const b = this.getScratchpadProduct({i:i, j:j, si:-1}, this.inks.getSelected(),c);
        sd.draft.pattern[i][j].setHeddle(b); 
      }
    }

    const had_merge = this.mergeSubdrafts(sd);
    this.addTimelineState();

  }

  /**
   * update the viewport when the window is resized
   * @param event 
   */
  @HostListener('window:resize', ['$event'])
    onResize(event) {

      this.viewport.setWidth(event.target.innerWidth);
      this.viewport.setHeight(event.target.innerHeight);

      this.canvas.width = this.viewport.getWidth();
      this.canvas.height = this.viewport.getHeight();
    }


 /**
  * handles actions to take when the mouse is down inside of the palette
  * @param event the mousedown event
  */
  @HostListener('mousedown', ['$event'])
    private onStart(event) {

      const ctrl: boolean = event.ctrlKey;
      const mouse:Point = {x: this.viewport.getTopLeft().x + event.clientX, y:this.viewport.getTopLeft().y+event.clientY};
      const ndx:any = utilInstance.resolveCoordsToNdx(mouse, this.scale);

      //use this to snap the mouse to the nearest coord
      mouse.x = ndx.j * this.scale;
      mouse.y = ndx.i * this.scale;

      
      this.last = ndx;
      this.selection.start = this.last;
      this.removeSubscription();    
      
     

      if(this.dm.getDesignMode("marquee",'design_modes').selected){
          this.selectionStarted();
          this.moveSubscription = 
          fromEvent(event.target, 'mousemove').subscribe(e => this.onDrag(e)); 
    
      }else if(this.dm.isSelected("draw",'design_modes')){
        this.moveSubscription = 
        fromEvent(event.target, 'mousemove').subscribe(e => this.onDrag(e)); 
  
          this.drawStarted();    
          this.setCell(ndx);
          this.drawCell(ndx); 
      }else if(this.dm.isSelected("shape",'design_modes')){
        this.moveSubscription = 
        fromEvent(event.target, 'mousemove').subscribe(e => this.onDrag(e)); 
  

        if(this.dm.isSelected('free','shapes')){
          if(ctrl){
            this.processShapeEnd();
            this.changeDesignmode('move');
            this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          }else{
            if(this.shape_vtxs.length == 0) this.shapeStarted(mouse);
            this.shape_vtxs.push(mouse);
          }
            
          
        }else{
          this.shapeStarted(mouse);
        }
      }else if(this.dm.isSelected("operation",'design_modes')){
        this.processConnectionEnd();
        this.changeDesignmode('move');
      }
  }


  @HostListener('mousemove', ['$event'])
  private onMove(event) {
    const shift: boolean = event.shiftKey;
    const mouse:Point = {x: this.viewport.getTopLeft().x + event.clientX, y:this.viewport.getTopLeft().y+event.clientY};
    const ndx:any = utilInstance.resolveCoordsToNdx(mouse, this.scale);
    mouse.x = ndx.j * this.scale;
    mouse.y = ndx.i * this.scale;

    if(this.dm.isSelected('free','shapes') && this.shape_vtxs.length > 0){
     this.shapeDragged(mouse, shift);
    }else if(this.selecting_connection){
      this.connectionDragged(mouse, shift);
    }
  }
  
 /**
  * called when the operation input is selected and used to draw
   * @param event the event object
   */
  mouseSelectingDraft(event: any, id: number){

    const shift: boolean = event.shiftKey;
    const mouse: Point = {x: this.viewport.getTopLeft().x + event.clientX, y:this.viewport.getTopLeft().y+event.clientY};
    const ndx:Interlacement = utilInstance.resolveCoordsToNdx(mouse, this.scale);
    //use this to snap the mouse to the nearest coord
    mouse.x = ndx.j * this.scale;
    mouse.y = ndx.i * this.scale;

    if(utilInstance.isSameNdx(this.last, ndx)) return;

    // if(this.dm.getDesignMode("operation",'design_modes').selected){

     
    
    // }
    
    this.last = ndx;
  }

  /**
   * called form the subscription created on start, checks the index of the location and returns null if its the same
   * @param event the event object
   */
  onDrag(event){


    const shift: boolean = event.shiftKey;
    const mouse: Point = {x: this.viewport.getTopLeft().x + event.clientX, y:this.viewport.getTopLeft().y+event.clientY};
    const ndx:Interlacement = utilInstance.resolveCoordsToNdx(mouse, this.scale);

    //use this to snap the mouse to the nearest coord
    mouse.x = ndx.j * this.scale;
    mouse.y = ndx.i * this.scale;

    if(utilInstance.isSameNdx(this.last, ndx)) return;

    if(this.dm.getDesignMode("marquee",'design_modes').selected){

     this.drawSelection(ndx);
     const bounds = this.getSelectionBounds(this.selection.start,  this.last);    
     this.selection.setPositionAndSize(bounds);
     this.updateSnackBar("Select Drafts to Join",  this.selection.bounds);

    
    }else if(this.dm.getDesignMode("draw", 'design_modes').selected){
      this.setCell(ndx);
      this.drawCell(ndx);
    }else if(this.dm.getDesignMode("shape",'design_modes').selected){
      this.shapeDragged(mouse, shift);
    }
    
    this.last = ndx;
  }

  

/**
 * Called when the mouse is up or leaves the boundary of the view
 * @param event 
 * @returns 
 */
  @HostListener('mouseleave', ['$event'])
  @HostListener('mouseup', ['$event'])
     private onEnd(event) {

      //if this.last is null, we have a mouseleave with no mousestart
      if(this.last === undefined) return;
      const mouse: Point = {x: this.viewport.getTopLeft().x + event.clientX, y:this.viewport.getTopLeft().y+event.clientY};
      const ndx:Interlacement = utilInstance.resolveCoordsToNdx(mouse, this.scale);
      //use this to snap the mouse to the nearest coord
      mouse.x = ndx.j * this.scale;
      mouse.y = ndx.i * this.scale;

      this.removeSubscription();   

      if(this.dm.getDesignMode("marquee",'design_modes').selected){
        if(this.selection.active)this.processSelection();
        this.closeSnackBar();
        this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.changeDesignmode('move');


      }else if(this.dm.isSelected("draw",'design_modes')){
        this.processDrawingEnd();
        this.closeSnackBar();
        this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.changeDesignmode('move');



      }else if(this.dm.isSelected("shape",'design_modes')){
        if(!this.dm.isSelected('free','shapes')){
          this.processShapeEnd();
          this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          this.changeDesignmode('move');
        }
      }

      //unset vars that would have been created on press
      this.scratch_pad = undefined;
      this.last = undefined;
      this.selection.active = false;
      this.canvas_zndx = -1; 
  }
  
 
  /**
   * Called when a selection operation ends. Checks to see if this selection intersects with any subdrafts and 
   * merges and or splits as required. 
   */
  processSelection(){

    this.closeSnackBar();

    //create the selection as subdraft
    const bounds:Bounds = this.getSelectionBounds(this.selection.start,  this.last);    
    
    const sc:SubdraftComponent = this.createSubDraft(new Draft({wefts: bounds.height/this.scale, warps: bounds.width/this.scale}));
    sc.setComponentBounds(bounds);
    sc.disableDrag();
    
    //get any subdrafts that intersect the one we just made
    const isect:Array<SubdraftComponent> = this.getIntersectingSubdrafts(sc);

    if(isect.length == 0){
      this.addTimelineState();
      return;
    } 

    //get a draft that reflects only the poitns in the selection view
    const new_draft: Draft = this.getCombinedDraft(bounds, sc, isect);
    sc.setNewDraft(new_draft);
    sc.drawDraft();

    isect.forEach(el => {
      const ibound = utilInstance.getIntersectionBounds(sc, el);

      if(el.isSameBoundsAs(ibound)){
         console.log("Component had same Bounds as Intersection, Consumed");
         this.removeSubdraft(el.id);
      }else{
         const sd_draft = el.draft.pattern;
         for(let i = 0; i < sd_draft.length; i++){
           for(let j = 0; j < sd_draft[i].length; j++){
           
              let p:Point = el.resolveNdxToPoint({i: i, j: j, si: -1});
              p.x += this.scale/2;
              p.y += this.scale/2;
              if(sc.hasPoint(p)) sd_draft[i][j].unsetHeddle();
           }
         }
         
        el.drawDraft();
        }
    });
    this.addTimelineState();

  }


  /**
   * this function will update any components that should move when the compoment passed by obj moves
   * moves all compoments returned from tree.getNodesToUpdate(). All changes to what updates should be 
   * handled by getNodesToUpdateOnMove
   * @param obj 
   */
  updateAttachedComponents(obj: any){

    const moving : any = this.tree.getComponent(obj.id);
    const updates: Array<number> = this.tree.getNodesToUpdateOnMove(obj.id);

    updates.forEach(u => {
      const type: string = this.tree.getType(u);
      const u_comp = this.tree.getComponent(u);
      
      //if this is a node that didn't call the command, its a parent or child. 
      if(obj.id !== u){

         if(type=='op') u_comp.setPosition({x: obj.point.x, y: obj.point.y - u_comp.bounds.height});
         if(type=='draft') u_comp.setPosition({x: obj.point.x, y: obj.point.y + moving.bounds.height});         
      
         const cxns: Array<number> = this.tree.getNodeConnections(u);

         cxns.forEach(cxn => {
           const comp: ConnectionComponent = <ConnectionComponent>this.tree.getComponent(cxn);
            if(type=='op') comp.updatePositionAndSize(u_comp.id,  {x: obj.point.x, y: obj.point.y- comp.bounds.height}, u_comp.bounds.width, u_comp.bounds.height);
            if(type=='draft') comp.updatePositionAndSize(u_comp.id, {x: obj.point.x, y: obj.point.y}, u_comp.bounds.width, u_comp.bounds.height);  
         });
      
      }else{
        const cxns: Array<number> = this.tree.getNodeConnections(u);
        cxns.forEach(cxn => {
          const comp: ConnectionComponent = <ConnectionComponent>this.tree.getComponent(cxn);
          comp.updatePositionAndSize(moving.id, obj.point, moving.bounds.width, moving.bounds.height);
        })
      }
     }); 
  }


  /**
   * emitted from a subdraft when an internal action has changeded its value 
   * checks for a child subdraft, recomputes, redraws. 
   * @param obj with attribute id describing the subdraft that called this
   * @returns 
   */
  onSubdraftAction(obj: any){
    console.log("on subdraft action", obj);
    if(obj === null) return;
    const ds: Array<number> = this.tree.getDownstreamOperations(obj.id);
    this.recalculateDownstreamDrafts(ds);
    this.addTimelineState();

  }

  /**
   * emitted from an operatioin when its param has changed 
   * checks for a child subdraft, recomputes, redraws. 
   * @param obj with attribute id describing the operation that called this
   * @returns 
   */
   operationParamChanged(obj: any){
    console.log("op param change", obj);

    if(obj === null) return;

    
    this.performOp(obj.id);

    const ds: Array<number> = this.tree.getDownstreamOperations(obj.id);
    this.recalculateDownstreamDrafts(ds);
    this.addTimelineState();

  }


/**
 * called from an operatiino cmoponent when it is dragged
 * @param obj (id, point of toplleft)
 */
  operationMoved(obj: any){
    if(obj === null) return;

    //get the reference to the draft that's moving
    const moving = <OperationComponent> this.tree.getComponent(obj.id);
    if(moving === null) return; 
    this.updateSnackBar("moving opereation "+moving.name,moving.bounds);
    this.updateAttachedComponents(obj);
    // this.addTimelineState();

  }



  subdraftMoved(obj: any){
      if(obj === null) return;
  
      //get the reference to the draft that's moving
      const moving = <SubdraftComponent> this.tree.getComponent(obj.id);
      if(moving === null) return; 

      this.updateSnackBar("Using Ink: "+moving.ink,moving.bounds);
      
      this.updateAttachedComponents(obj);

      const isect:Array<SubdraftComponent> = this.getIntersectingSubdrafts(moving);
      
      if(isect.length == 0){
        if(this.hasPreview()) this.removePreview();
        return;
      } 

      //const bounds: Bounds = this.getIntersectionBounds(moving, isect[0]);
      const bounds: Bounds = utilInstance.getCombinedBounds(moving, isect);
      const temp: Draft = this.getCombinedDraft(bounds, moving, isect);
      if(this.hasPreview()) this.preview.setNewDraft(temp);
      else this.createAndSetPreview(temp);
      this.preview.setPosition(bounds.topleft);
      this.preview.drawDraft(); 
      const interlacement = utilInstance.resolvePointToAbsoluteNdx(bounds.topleft, this.scale); 
      this.viewport.updatePoint(this.preview.id, interlacement);    
    }


   /**
    * checks if this subdraft has been dropped onto of another and merges them accordingly 
    * @param obj 
    * @returns 
    */
  subdraftDropped(obj: any){

    this.closeSnackBar();

     if(obj === null) return;
  
      //creaet a subdraft of this intersection
      if(this.hasPreview()){
        const sd: SubdraftComponent = this.createSubDraft(new Draft({wefts: this.preview.draft.wefts, warps: this.preview.draft.warps}));
        const to_right: Point = this.preview.getTopleft();
        to_right.x += this.preview.bounds.width + this.scale *4;
        sd.draft.pattern = cloneDeep(this.preview.draft.pattern);
        sd.setPosition(to_right);
        sd.setComponentSize(this.preview.bounds.width, this.preview.bounds.height);
        sd.zndx = this.layers.createLayer();
        this.removePreview();
        const interlacement = utilInstance.resolvePointToAbsoluteNdx(sd.bounds.topleft, this.scale);
        this.viewport.addObj(sd.id, interlacement);
      } 

    
      this.addTimelineState();
      
      //get the reference to the draft that's moving
      const moving = this.tree.getComponent(obj.id);
      const interlacement = utilInstance.resolvePointToAbsoluteNdx(moving.bounds.topleft, this.scale);
      this.viewport.updatePoint(moving.id, interlacement);
      if(moving === null) return; 


      

      //disable this to see what happens
      // const had_merge = this.mergeSubdrafts(moving);
      // console.log("had merge", had_merge);
      // if(!had_merge) 
      // moving.drawDraft();

  }

  /**
   * merges a collection of subdraft components into the primary component, deletes the merged components
   * @param primary the draft to merge into
   * @returns true or false to describe if a merge took place. 
   */
  mergeSubdrafts(primary: SubdraftComponent): boolean{

    const isect:Array<SubdraftComponent> = this.getIntersectingSubdrafts(primary);

      if(isect.length == 0){
        return false;
      }   

      const bounds: Bounds = utilInstance.getCombinedBounds(primary, isect);
      const temp: Draft = this.getCombinedDraft(bounds, primary, isect);

      primary.setNewDraft(temp);
      primary.setPosition(bounds.topleft);
      primary.drawDraft();
      const interlacement = utilInstance.resolvePointToAbsoluteNdx(primary.bounds.topleft, this.scale);

      this.viewport.updatePoint(primary.id, interlacement);


    //remove the intersecting drafts from the view containier and from subrefts
    isect.forEach(element => {
      this.removeSubdraft(element.id);
    });
    return true;
  }

  computeHeddleValue(p:Point, main: SubdraftComponent, isect: Array<SubdraftComponent>):boolean{
    const a:boolean = main.resolveToValue(p);
    //this may return an empty array, because the intersection might not have the point
    const b_array:Array<SubdraftComponent> = isect.filter(el => el.hasPoint(p));

    //should never have more than one value in barray
    // if(b_array.length > 1) console.log("WARNING: Intersecting with Two Elements");

    const val:boolean = b_array.reduce((acc:boolean, arr) => arr.resolveToValue(p), null);   
    
    return utilInstance.computeFilter(main.ink, a, val);
  }



  getSubdraftsIntersectingSelection(selection: MarqueeComponent){

    //find intersections between main and the others
    const drafts: Array<SubdraftComponent> = this.tree.getDrafts();
    const isect:Array<SubdraftComponent> = drafts.filter(sr => (utilInstance.doOverlap(
      selection.bounds.topleft, 
      {x:  selection.bounds.topleft.x + selection.bounds.width, y: selection.bounds.topleft.y + selection.bounds.height}, 
      sr.getTopleft(), 
      {x: sr.getTopleft().x + sr.bounds.width, y: sr.getTopleft().y + sr.bounds.height}
      ) ? sr : null));

    return isect;
  
  }


 /**
   * get any subdrafts that intersect a given screen position
   * @param p the x, y position of this cell 
   * @returns 
   */
  getIntersectingSubdraftsForPoint(p: any){

    const primary_topleft = {x:  p.x, y: p.y };
    const primary_bottomright = {x:  p.x + this.scale, y: p.y + this.scale};

    const isect:Array<SubdraftComponent> = [];
    const drafts: Array<SubdraftComponent> = this.tree.getDrafts();
    drafts.forEach(sr => {
      let sr_bottomright = {x: sr.getTopleft().x + sr.bounds.width, y: sr.getTopleft().y + sr.bounds.height};
      const b: boolean = utilInstance.doOverlap(primary_topleft, primary_bottomright, sr.getTopleft(), sr_bottomright);
      if(b) isect.push(sr);
     });

    return isect;
  }

  /**
   * get any subdrafts that intersect primary based on checks on their boundaries
   * @param primary 
   * @returns 
   */
  getIntersectingSubdrafts(primary: SubdraftComponent){

    const drafts:Array<SubdraftComponent> = this.tree.getDrafts(); 
    const to_check:Array<SubdraftComponent> =  drafts.filter(sr => (sr.draft.id.toString() !== primary.draft.id.toString()));
    const primary_bottomright = {x:  primary.getTopleft().x + primary.bounds.width, y: primary.getTopleft().y + primary.bounds.height};


     const isect:Array<SubdraftComponent> = [];
     to_check.forEach(sr => {
      let sr_bottomright = {x: sr.getTopleft().x + sr.bounds.width, y: sr.getTopleft().y + sr.bounds.height};
      const b: boolean = utilInstance.doOverlap(primary.getTopleft(), primary_bottomright, sr.getTopleft(), sr_bottomright);
      if(b) isect.push(sr);
     });

    return isect;
  }

  getSelectionBounds(c1: any, c2: any): Bounds{
      let bottomright = {x: 0, y:0};
      let bounds:Bounds = {
        topleft:{x: 0, y:0},
        width: 0,
        height: 0
      }
      if(c1.i < c2.i){
        bounds.topleft.y = c1.i * this.scale;
        bottomright.y = c2.i * this.scale;
      }else{
        bounds.topleft.y = c2.i * this.scale;
        bottomright.y = c1.i * this.scale;
      }

      if(c1.j < c2.j){
        bounds.topleft.x = c1.j * this.scale;
        bottomright.x = c2.j * this.scale;
      }else{
        bounds.topleft.x = c1.j * this.scale;
        bottomright.x = c2.j * this.scale;
      }

      bounds.width = bottomright.x - bounds.topleft.x;
      bounds.height = bottomright.y - bounds.topleft.y;

      return bounds;
  }

      /**
     * creates a draft in size bounds that contains all of the computed points of its intersections
     * @param bounds the boundary of all the intersections
     * @param primary the primary draft that we are checking for intersections
     * @param isect an Array of the intersecting components
     * @returns 
     */
       getCombinedDraft(bounds: Bounds, primary: SubdraftComponent, isect: Array<SubdraftComponent>):Draft{
  
        const temp: Draft = new Draft({id: primary.draft.id, name: primary.draft.name, warps: Math.floor(bounds.width / primary.scale), wefts: Math.floor(bounds.height / primary.scale)});
    
        for(var i = 0; i < temp.wefts; i++){
          const top: number = bounds.topleft.y + (i * primary.scale);
          for(var j = 0; j < temp.warps; j++){
            const left: number = bounds.topleft.x + (j * primary.scale);
    
            const p = {x: left, y: top};
            const val = this.computeHeddleValue(p, primary, isect);
            if(val != null) temp.pattern[i][j].setHeddle(val);
            else temp.pattern[i][j].unsetHeddle();
          }
        }
        return temp;
      }



      /**
       * TODO: Update this to get bounds and print all items, not just what's visible
       * @param obj 
       * @returns 
       */
  getPrintableCanvas(obj): HTMLCanvasElement{

    this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const drafts: Array<SubdraftComponent> = this.tree.getDrafts();
    drafts.forEach(sd => {
      sd.drawForPrint(this.canvas, this.cx, this.scale);
    });

    const ops: Array<OperationComponent> = this.tree.getOperations();
    ops.forEach(op => {
      op.drawForPrint(this.canvas, this.cx, this.scale);
    });

    const cxns: Array<ConnectionComponent> = this.tree.getConnections();
    cxns.forEach(cxn => {
      cxn.drawForPrint(this.canvas, this.cx, this.scale);
    });

    this.note_components.forEach(note =>{
      note.drawForPrint(this.canvas, this.cx, this.scale);
    })

    return this.canvas;

  }

  clearCanvas(){
    this.cx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  redrawOpenModals(){
    const comps = this.tree.getDrafts();
    comps.forEach(sd => {
      if(sd.modal !== undefined && sd.modal.componentInstance !== undefined){
        sd.modal.componentInstance.redraw();
      }
    })
  }

}