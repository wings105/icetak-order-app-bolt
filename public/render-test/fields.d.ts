import type {RenderConfig,TextLayer} from './renderer.js';
export function patternKeys(pattern?:string):string[];
export function getInputFields(config:RenderConfig):{key:string;label:string}[];
export function validatePatterns(config:RenderConfig):void;
export function resolveValues(config:RenderConfig,input:Record<string,string>,options?:{required?:boolean;strict?:boolean}):Record<string,string>;
export function resolveLayerText(layer:TextLayer,values:Record<string,string>):string;
