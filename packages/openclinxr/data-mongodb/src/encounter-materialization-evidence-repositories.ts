import type { Collection, Db } from "mongodb";
import type { EncounterMaterializationEvidenceRecord } from "./records.js";

/**
 * WCG-3 materialization-evidence persistence. One document per unique
 * {scenarioId, caseDefVersion, compileVersion}; contentHash per compile node is
 * the sha256 of the artifact bytes at its sourceBlobName, or null (never a
 * placeholder literal). Pattern mirrors MongoScenarioRepository.
 */
export class MongoEncounterMaterializationEvidenceRepository {
  private readonly collection: Collection<EncounterMaterializationEvidenceRecord>;

  constructor(db: Db) {
    this.collection = db.collection<EncounterMaterializationEvidenceRecord>("encounter_materialization_evidence");
  }

  async ensureIndexes(): Promise<void> {
    // Unique per materialization compile. Leading scenarioId field also serves
    // listByScenario (equality) with caseDefVersion/compileVersion sort order.
    await this.collection.createIndex(
      { scenarioId: 1, caseDefVersion: 1, compileVersion: 1 },
      { unique: true },
    );
  }

  async upsert(record: EncounterMaterializationEvidenceRecord): Promise<void> {
    await this.collection.updateOne(
      {
        scenarioId: record.scenarioId,
        caseDefVersion: record.caseDefVersion,
        compileVersion: record.compileVersion,
      },
      { $set: record },
      { upsert: true },
    );
  }

  async findByScenarioAndVersions(
    scenarioId: string,
    caseDefVersion: number,
    compileVersion: number,
  ): Promise<EncounterMaterializationEvidenceRecord | null> {
    return this.collection.findOne(
      { scenarioId, caseDefVersion, compileVersion },
      { projection: { _id: 0 } },
    );
  }

  async listByScenario(scenarioId: string): Promise<EncounterMaterializationEvidenceRecord[]> {
    return this.collection
      .find({ scenarioId }, { projection: { _id: 0 } })
      .sort({ caseDefVersion: 1, compileVersion: 1 })
      .toArray();
  }
}
