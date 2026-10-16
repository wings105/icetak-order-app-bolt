/** Remove known export boilerplate for customer-facing labels; source titles stay intact in the DB. */
export function customerProductTitle(value:string){
 if(/wafer paper\s*\+\s*edible image/i.test(value))return 'Burn Away · Edible + Wafer';
 if(/^custom any image printing wafer paper/i.test(value))return 'Wafer Paper Custom';
 if(/^\[(?:pre order|custom acrylic)/i.test(value)&&/acrylic cake topper/i.test(value))return 'Acrylic Cake Topper Custom';
 return value.replace(/^\[CUSTOM NAME\]\s*(?:Happy Birthday\s*)?/i,'').replace(/^Printing\s+EI\s+/i,'').replace(/\s+Decoration Set Party Accessories.*$/i,'').replace(/\s+Edible Image Print.*$/i,'').trim()||value;
}
