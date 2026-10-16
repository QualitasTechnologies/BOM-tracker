const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {applyMilestoneCommand}=require('./milestoneCommands.cjs');
test('native template dates match the original browser setDate through timezone and DST transitions',()=>{
  const cases=[['America/New_York','2026-03-01T00:30:00Z','2026-04-01'],['America/New_York','2026-10-24T23:30:00Z','2026-12-01'],['Europe/London','2026-03-15T00:30:00Z','2026-05-01'],['Asia/Kolkata','2026-10-15T19:10:00Z','2026-12-31'],['Pacific/Apia','2011-12-15T00:30:00Z','2012-01-20']];
  const source="const [start,end]=JSON.parse(process.argv[1]); const a=[25,50,80,100].map(p=>{const d=new Date(start);const n=Math.ceil((new Date(end)-d)/86400000);d.setDate(d.getDate()+Math.round(n*p/100));return d.toISOString().slice(0,10);});process.stdout.write(JSON.stringify(a));";
  for(const[zone,start,deadline]of cases){
    const expected=JSON.parse(execFileSync(process.execPath,['-e',source,JSON.stringify([start,deadline])],{env:{...process.env,TZ:zone},encoding:'utf8'}));
    const result=applyMilestoneCommand({project:{projectId:'P',deadline},milestones:[],command:{kind:'template',time_zone:zone},actor:{uid:'alice',email:'alice@example.com'},now:new Date(start),operationId:'timezone'});
    assert.deepEqual(result.upserts.map(row=>row.data.currentPlannedEndDate),expected,zone);
  }
});
