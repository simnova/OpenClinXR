// Planted current nine-shape mapping, deliberately exposing its semantic/binding defects.
const current = {A:"AA",B:"E",C:"IH",D:"OH",E:"OU",F:"FV",G:"L",H:"OU",X:"sil"};
export function convertRhubarb(doc) {
 return (doc.mouthCues ?? []).map(c => ({phoneme: current[c.value] ?? "sil", atSecond:c.start, durationSeconds:c.end-c.start}));
}
