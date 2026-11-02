"use strict";
const assert = require('node:assert/strict');
const {X,D,IDS,inputsFor} = require('./lib');
const clone = x => JSON.parse(JSON.stringify(x));
let E=X.initCities(IDS,D,{seed:'g3-fiscal-contract',months:36});
E=X.calibrate(E,inputsFor(E,()=>({})),D);
let paid=clone(E), annual={}, fixed={}, checks=0;
for(let m=0;m<36;m++){
  const ins=inputsFor(E,()=>({}));
  // Exercise explicit advance payment, normal payment and serialized state equally.
  paid=X.yearStart(clone(paid),D).E;
  const a=X.monthStep(E,ins,D), b=X.monthStep(paid,ins,D);
  for(const id of IDS){
    const f=a.report.fiscal[id], c=a.E.cities[id];
    if(m%12===0){annual[id]=4*f.rev.subsidy;fixed[id]=D.params.subBase.v+f.equalize;}
    const expected=(f.rev.resTax+(annual[id]-fixed[id])/12+f.rev.tariff-f.exp.service)/c.pop;
    assert.ok(Number.isFinite(f.perResidentNet));
    assert.ok(Math.abs(f.perResidentNet-expected)<1e-12,'monthly per-capita allocation');
    assert.equal(b.report.fiscal[id].perResidentNet,f.perResidentNet,'advance payment cannot alter allocation');
    assert.equal(b.E.cities[id].cash,c.cash,'advance payment cannot alter cash');
    checks+=4;
  }
  E=a.E;paid=clone(b.E);
}
console.log(`G3 fiscal contract pass ${checks} fail 0`);
