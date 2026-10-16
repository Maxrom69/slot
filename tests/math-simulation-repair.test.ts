import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMathSimulationEngine, createSampleGameBlueprint, createSeededRng, DefaultRngFactory, adaptBlueprintToGameConfig, computeGameConfigHash, normalizeGameDefinition, InvalidSimulationConfigurationError, SimulationExecutionError, SimulationGuardExceededError, SimulationReplayError, type SimulationConfig, type FeatureEngineConfiguration } from "../src/engine";
const A="sym-low-a",K="sym-low-k",Q="sym-low-q",S="sym-high-star",SC="sym-scatter";
const STOPS=[0,0,0,0,0], LOSS=[0,5,1,0,0];
const LOSING_REFILL=[[K,K,K],[Q,Q,Q],[S,S,S],[K,Q,S],[Q,S,A]];
function game() { const bp=createSampleGameBlueprint(); bp.features=[]; return bp; }
function features(initialSpins=2): FeatureEngineConfiguration {
  const config=adaptBlueprintToGameConfig(game());
  return { baseReels:config.reels,visibleRows:3,features:[{id:"fs",name:"Two authored spins",mode:"freeSpins",startingMultiplier:2,alternateReels:[[A,A,A],[A,A,A],[A,A,A],[K,K,K],[Q,Q,Q]],triggers:[{id:"one-scatter",source:"symbolCount",targetFeatureId:"fs",symbolIds:[SC],threshold:1}],freeSpins:{initialSpins,retriggerEnabled:false}}] };
}
function run(options: Partial<SimulationConfig>={}) { return createMathSimulationEngine().run(game(),{spinCount:1,bet:5,seed:"b16-repair",fixedStops:STOPS,...options}).report; }

describe("B16 repaired complete-round execution and missing edge cases",()=>{
  it("authored standard statistics: 9 and 0, exact 90% RTP, percentile boundaries and variance",()=>{
    const r=run({spinCount:4,fixedStops:[STOPS,LOSS],percentiles:[0,25,50,75,100],retainRawWinSamples:true,collectDiagnostics:true});
    assert.equal(r.totalWager,20);assert.equal(r.totalPayout,18);assert.equal(r.rtp.rtpPercentage,90);assert.equal(r.winningSpins,2);assert.equal(r.losingSpins,2);
    assert.deepEqual(r.rawWinSamples,[9,0,9,0]);assert.deepEqual(r.distribution.percentiles,{p0:0,p25:0,p50:0,p75:9,p100:9});assert.equal(r.volatility.populationVarianceNormalizedReturn,.81);
    assert.deepEqual(r.diagnostics,{attemptedRounds:4,completedRounds:4,failedRounds:0,parentDrawsConsumed:4});
  });
  it("actual alternate feature reels and B14 x2 settle each free step, charging the wager only once",()=>{
    // Every feature board has five lines of AAA: 5 * (2 * per-line bet 1) = 10; x2 = 20, twice = 40.
    const r=run({fixedStops:LOSS,featureConfig:features(),retainSpinTraces:true,retainBoardSnapshots:true});
    assert.equal(r.totalWager,5);assert.equal(r.totalPayout,40);assert.equal(r.rtp.baseGamePayout,0);assert.equal(r.rtp.featurePayout,40);
    assert.equal(r.traces[0]!.featureSteps!.length,2);assert.deepEqual(r.traces[0]!.featureSteps!.map((s)=>s.win),[20,20]);
    assert.deepEqual(r.traces[0]!.finalBoardSnapshot,[[A,A,A],[A,A,A],[A,A,A],[K,K,K],[Q,Q,Q]]);
    assert.equal(r.features.totalFeatureEntries,1);assert.equal(r.features.averageFeatureDurationSpins,2);assert.equal(r.bankroll.endingBalance,5035);
    assert.equal(Object.values(r.traces[0]!.winBySource).reduce((a,b)=>a+b,0),40);
  });
  it("feature steps run real B13 cascades and B14 multipliers, not a reduced evaluator",()=>{
    const r=run({fixedStops:LOSS,featureConfig:features(),tumbleConfig:{reelStrips:LOSING_REFILL},retainSpinTraces:true});
    assert.equal(r.totalPayout,40);assert.equal(r.traces[0]!.cascadeCount,2);assert.deepEqual(r.traces[0]!.cascadePayouts,[20,20]);assert.equal(r.cascades.totalTumbleCount,2);
    assert.equal(r.cascades.maxMultiplierReached,2);
  });
  it("B15 session meters advance across base and feature steps and survive into the next round",()=>{
    const r=run({spinCount:2,fixedStops:LOSS,featureConfig:features(),retainSpinTraces:true,meters:[{meterId:"steps",scope:"session",startingValue:0,eventSource:{eventType:"spinsPlayed"}}]});
    assert.equal(r.totalPayout,80);assert.equal(r.totalWager,10);assert.deepEqual(r.traces.map((s)=>s.meterValues!.steps),[3,6]);
  });
  it("configured B14 values and collection use the real value engine without duplicate awards",()=>{
    // Four A cells at value 2 -> eight units collected * bet 5 = 40; three line wins pay 9.
    const r=run({multiplierConfig:{assignedValues:[{id:"fixed-two",symbolIds:[A],mode:"fixed",fixedValue:2}],collection:{id:"collect",mode:"collect",collectorSymbolIds:[S],eligibleSourceSymbolIds:[A],sourcePersistence:"consume"}}});
    assert.equal(r.totalPayout,49);assert.equal(r.winSources.bySource.featureValue.totalPayout,40);
  });
  it("global round win cap is enforced across base and feature steps",()=>{
    const bp=game();bp.math.maxWinX=5;
    const r=createMathSimulationEngine().run(bp,{spinCount:1,seed:1,bet:5,fixedStops:LOSS,featureConfig:features(),retainSpinTraces:true}).report;
    assert.equal(r.totalPayout,25);assert.equal(r.traces[0]!.featureWin,25);assert.deepEqual(r.traces[0]!.featureSteps!.map((s)=>s.win),[20,5]);assert.equal(r.maxWin.maxWinInBetMultiples,5);
    assert.equal(Object.values(r.traces[0]!.winBySource).reduce((a,b)=>a+b,0),25);
  });
  it("replay is self-contained for custom features, cascades, multipliers and persistent meters",()=>{
    const engine=createMathSimulationEngine(),bp=game();const r=engine.run(bp,{spinCount:2,seed:"replay",bet:5,fixedStops:LOSS,featureConfig:features(),tumbleConfig:{reelStrips:LOSING_REFILL},meters:[{meterId:"steps",scope:"session",startingValue:0,eventSource:{eventType:"spinsPlayed"}}],retainSpinTraces:true,retainBoardSnapshots:true}).report;
    for(const spin of r.traces)assert.deepEqual(engine.replaySpin(bp,JSON.parse(JSON.stringify(spin.replayPackage))),spin);
    assert.throws(()=>engine.replaySpin(bp,r.traces[0]!.replayPackage,{featureConfig:features(1)}),SimulationReplayError);
  });
  it("replay restores a losing-spin policy even when no meter definitions are configured",()=>{
    const engine=createMathSimulationEngine(),bp=game();const r=engine.run(bp,{spinCount:2,seed:"losing",bet:5,fixedStops:LOSS,losingSpinActions:{sequenceId:"loss-prize",actions:[{actionId:"six",type:"awardPrize",prizeAmount:6}]},retainSpinTraces:true}).report;
    assert.equal(r.totalPayout,12);assert.deepEqual(engine.replaySpin(bp,r.traces[1]!.replayPackage),r.traces[1]);
  });
  it("cascades without an authored cap abort at the safety guard rather than silently accepting a partial spin",()=>{
    assert.throws(()=>run({tumbleConfig:{reelStrips:[[A,A,A],[A,A,A],[A,A,A],[A,A,A],[A,A,A]]}}),SimulationGuardExceededError);
  });
  it("an explicitly authored cascade limit is a mechanic policy, not a hidden safety truncation",()=>{
    const r=run({tumbleConfig:{reelStrips:[[A,A,A],[A,A,A],[A,A,A],[A,A,A],[A,A,A]]},maxCascadeStepsPerSpin:1});
    // Only the nine winning cells on reels 0–2 are refilled. Five AAA lines pay 2 each, so 9 + 10 = 19.
    assert.equal(r.totalPayout,19);assert.equal(r.cascades.totalTumbleCount,1);
  });
  it("unfinished features abort before being counted as complete rounds",()=>{
    assert.throws(()=>run({fixedStops:LOSS,featureConfig:features(3),maxFeatureStepsPerRound:2}),SimulationGuardExceededError);
  });
  it("operation budget is enforced inside a feature/cascade, not only after a round returns",()=>{
    assert.throws(()=>run({fixedStops:LOSS,featureConfig:features(),maxOperationsGuard:1}),SimulationGuardExceededError);
  });
  it("wall-time guard requires a real host clock, and injected monotonic timing is enforced",()=>{
    assert.throws(()=>run({maxExecutionTimeMs:5}),InvalidSimulationConfigurationError);
    let ticks=0;const engine=createMathSimulationEngine({monotonicNowMs:()=>ticks++});
    assert.throws(()=>engine.run(game(),{spinCount:20,bet:5,maxExecutionTimeMs:3}),SimulationGuardExceededError);
    let bad=10;const backwards=createMathSimulationEngine({monotonicNowMs:()=>bad--});assert.throws(()=>backwards.run(game(),{spinCount:1,maxExecutionTimeMs:3}),InvalidSimulationConfigurationError);
  });
  it("invalid enums, monetary precision, unsafe counts, schedules and percentiles are rejected before execution",()=>{
    const invalid: Partial<SimulationConfig>[]=[{initialBankroll:-1},{initialBankroll:NaN},{bet:.00001},{batchSize:Infinity},{spinCount:Number.MAX_SAFE_INTEGER+1},{maxOperationsGuard:NaN},{maxCascadeStepsPerSpin:-1},{percentiles:[101]},{percentiles:[NaN]},{percentiles:[50,50]},{fixedStops:[]},{activePaylineIds:["line-1","line-1"]},{mode:"bogus" as "statistical"},{errorPolicy:"bogus" as "failFast"},{selectedMode:"freeSpins"}];
    for(const options of invalid)assert.throws(()=>run(options),InvalidSimulationConfigurationError,JSON.stringify(options));
  });
  it("custom distribution buckets are real, complete and nonoverlapping",()=>{
    const r=run({spinCount:4,fixedStops:[STOPS,LOSS],winDistributionBuckets:[{label:"small",minMultipleInclusive:0,maxMultipleExclusive:2},{label:"large",minMultipleInclusive:2,maxMultipleExclusive:null}]});
    assert.deepEqual(r.distribution.winningSpinDistributionBuckets.map((b)=>[b.label,b.spinCount,b.totalPayout]),[["small",2,18],["large",0,0]]);
    assert.throws(()=>run({winDistributionBuckets:[{label:"gap",minMultipleInclusive:1,maxMultipleExclusive:null}]}),InvalidSimulationConfigurationError);
  });
  it("failed attempts are never added as zero wins, wagers or valid history",()=>{
    const r=run({spinCount:4,fixedStops:[STOPS,[999,0,0,0,0]],errorPolicy:"collectAndContinue",retainSpinTraces:true,collectDiagnostics:true});
    assert.equal(r.spinCount,2);assert.equal(r.errorCount,2);assert.equal(r.totalWager,10);assert.equal(r.totalPayout,18);assert.equal(r.losingSpins,0);assert.equal(r.traces.length,2);
  });
  it("report comparison notices mechanics and full state differences even with identical outcomes",()=>{
    const engine=createMathSimulationEngine(),a=run({spinCount:2}),b=run({spinCount:2,activePaylineIds:["line-1"]});
    assert.equal(engine.compareReports(a,b).sameConfigurationAndSeed,false);
    const changed={...a,stats:{...a.stats,bankroll:{...a.stats.bankroll,endingBalance:a.stats.bankroll.endingBalance+1}}};assert.equal(engine.compareReports(a,changed).exactMatch,false);
  });
  it("definition fingerprints include payout-affecting math and advanced configuration",()=>{
    const config=adaptBlueprintToGameConfig(game()),changed={...config,math:{...config.math,maxWinX:1}};assert.notEqual(computeGameConfigHash(config),computeGameConfigHash(changed));
  });
  it("batch equivalence includes the real feature pipeline and the continued B03 stream",()=>{
    const a=run({spinCount:4,batchSize:1,fixedStops:LOSS,featureConfig:features()}),b=run({spinCount:4,batchSize:4,fixedStops:LOSS,featureConfig:features()});
    assert.deepEqual(a.stats,b.stats);assert.deepEqual(a.seedMetadata,b.seedMetadata);assert.equal(createMathSimulationEngine().compareReports(a,b).exactMatch,true);
  });
  it("byte-array seed and caller config remain usable and are not frozen by reporting",()=>{
    const seed=new Uint8Array([1,2,3]),options={spinCount:2,seed,bet:5,percentiles:[25,50]};const engine=createMathSimulationEngine();const a=engine.run(game(),options).report,b=engine.run(game(),options).report;
    assert.deepEqual(a.stats,b.stats);assert.equal(Object.isFrozen(options),false);options.percentiles.push(75);seed[0]=9;assert.doesNotThrow(()=>JSON.stringify(a));
  });
  it("unsafe fixed-point accumulation and malformed calibration targets are not silently accepted",()=>{
    assert.throws(()=>run({bet:10000000000,spinCount:1000}),InvalidSimulationConfigurationError);
    const r=run();assert.throws(()=>createMathSimulationEngine().evaluateTargetCompliance(r,{targetRtpPercentage:NaN,allowedRtpBandPlusMinusPercentagePoints:1}),InvalidSimulationConfigurationError);
    assert.throws(()=>createMathSimulationEngine().evaluateTargetCompliance(r,{targetRtpPercentage:90,allowedRtpBandPlusMinusPercentagePoints:-1}),InvalidSimulationConfigurationError);
    assert.throws(()=>run({initialBankroll:900719925474.0991,bet:5}),SimulationExecutionError);
  });
  it("canonical enabled modes select actual B09, B10 and B11 engines rather than the legacy grid mode",()=>{
    for(const [mode,expected] of [["ways",0],["clusters",0],["payAnywhere",180]] as const){
      // K=6 => highest K payout 20; Q=3 => 4; STAR=3 => 10; A=3 => 2. Total bet 5 => 180 anywhere.
      const bp=game();bp.reels.strips=[[K,K,K],[Q,Q,Q],[S,S,S],[A,A,A],[K,K,K]];const d=normalizeGameDefinition(bp);
      const source={...d,winEvaluation:{...d.winEvaluation,primaryMode:mode,enabledModes:[mode]},waysConfiguration:{...d.waysConfiguration,enabled:mode==="ways"},clusterConfiguration:{...d.clusterConfiguration,enabled:mode==="clusters"},payAnywhereConfiguration:{...d.payAnywhereConfiguration,enabled:mode==="payAnywhere"}};
      const r=createMathSimulationEngine().run(source,{spinCount:1,seed:1,bet:5,fixedStops:STOPS}).report;assert.equal(r.totalPayout,expected);assert.equal(r.winSources.bySource.payline.totalPayout,0);
    }
  });
  it("an all-failed run has no sample spin, wager, payout or invented losing result",()=>{
    const r=run({spinCount:2,fixedStops:[999,0,0,0,0],errorPolicy:"collectAndContinue"});assert.equal(r.spinCount,0);assert.equal(r.sampleReplayPackage,null);assert.equal(r.totalWager,0);assert.equal(r.totalPayout,0);assert.equal(r.losingSpins,0);
  });

  it("base-game awards also obey the round cap rather than only reporting the configured limit",()=>{
    const bp=game();bp.math.maxWinX=1;const r=createMathSimulationEngine().run(bp,{spinCount:1,seed:1,bet:5,fixedStops:STOPS,retainSpinTraces:true}).report;assert.equal(r.totalPayout,5);assert.equal(r.traces[0]!.capTrimmed,4);assert.equal(r.rtp.baseGamePayout,5);
  });
  it("B15 upgrades are counted and feature awards are attributed to the actual B12 feature IDs",()=>{
    const fs=features(),superFeature={...fs.features[0]!,id:"super",name:"Super",triggers:[],startingMultiplier:3,freeSpins:{initialSpins:1,retriggerEnabled:false}};
    const r=run({fixedStops:LOSS,featureConfig:{...fs,features:[...fs.features,superFeature]},retainSpinTraces:true,meters:[{meterId:"upgrade",scope:"session",startingValue:0,eventSource:{eventType:"spinsPlayed"},thresholds:[{thresholdId:"two",threshold:2,actions:[{actionId:"upgrade",type:"featureRequest",requestType:"upgradeFeature",featureId:"fs",targetFeatureId:"super",extraSpins:1,startingMultiplier:3}]}]}]});
    // One 20-credit original step, then two 30-credit upgraded steps.
    assert.equal(r.totalPayout,80);assert.equal(r.features.totalUpgrades,1);assert.equal(r.features.byFeatureId.fs!.totalPayout,20);assert.equal(r.features.byFeatureId.super!.totalPayout,60);
    assert.equal(r.features.byFeatureId.fs!.totalSpinsPlayed,1);assert.equal(r.features.byFeatureId.super!.totalSpinsPlayed,2);
  });
  it("an individual captured feature step also replays without the parent run options",()=>{
    const engine=createMathSimulationEngine(),bp=game();const r=engine.run(bp,{spinCount:1,seed:1,bet:5,fixedStops:LOSS,featureConfig:features(),retainSpinTraces:true}).report;const child=r.traces[0]!.featureSteps![0]!;assert.deepEqual(engine.replaySpin(bp,JSON.parse(JSON.stringify(child.replayPackage))),child);
  });

  it("B03 snapshot repair preserves numeric/byte seed metadata and future fork streams for both algorithms",()=>{
    for(const algorithm of ["mulberry32-v1","sfc32-v1"] as const)for(const seed of [42,new Uint8Array([1,2,3]),"string-root"]){
      const root=createSeededRng(seed,{algorithm});root.nextUint32();
      for(const rng of [root,root.fork("child")]){
        rng.nextUint32();const snapshot=JSON.parse(JSON.stringify(rng.snapshot()));const restored=new DefaultRngFactory().restoreFromState(snapshot);
        assert.deepEqual(restored.snapshot(),snapshot);assert.equal(restored.nextUint32(),rng.nextUint32());assert.equal(restored.fork("future").nextUint32(),rng.fork("future").nextUint32());
      }
    }
  });

});
