import { type ReactElement, useEffect, useMemo, useState } from "react";
import { EncounterBundlePromotionPanel } from "./EncounterBundlePromotionPanel.js";
import {
  defaultFacultyEncounterBundlePromotionSelection,
  type FacultyEncounterBundlePromotionSelection,
  type FacultyLearnerLaunchIdentity,
} from "./faculty-encounter-bundle-promotion.js";

export type FacultyEncounterBundlePromotionClient = {
  previewFacultyEncounterBundlePromotion(
    selection: FacultyEncounterBundlePromotionSelection,
  ): Promise<{
    canPromote: boolean;
    blockers: string[];
    attestations: string[];
  }>;
  promoteFacultyEncounterBundle(
    selection: FacultyEncounterBundlePromotionSelection,
  ): Promise<{
    promoted: boolean;
    learnerLaunchIdentity: FacultyLearnerLaunchIdentity | null;
    blockers?: string[];
  }>;
};

export type FacultyEncounterBundlePromotionHostProps = {
  client: FacultyEncounterBundlePromotionClient;
  scenarioId: string;
  stationId: string;
};

export function FacultyEncounterBundlePromotionHost({
  client,
  scenarioId,
  stationId,
}: FacultyEncounterBundlePromotionHostProps): ReactElement {
  const selection = useMemo(
    () => defaultFacultyEncounterBundlePromotionSelection(scenarioId, stationId),
    [scenarioId, stationId],
  );
  const [previewBlockers, setPreviewBlockers] = useState<string[]>([]);
  const [previewAttestations, setPreviewAttestations] = useState<string[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [submitMessage, setSubmitMessage] = useState<string | undefined>();
  const [launchIdentity, setLaunchIdentity] = useState<FacultyLearnerLaunchIdentity | null>(null);

  useEffect(() => {
    let active = true;
    void client.previewFacultyEncounterBundlePromotion(selection).then((preview) => {
      if (!active) {
        return;
      }
      setPreviewBlockers(preview.blockers);
      setPreviewAttestations(preview.attestations);
    }).catch((error: unknown) => {
      if (active) {
        setPreviewBlockers([error instanceof Error ? error.message : "preview_failed"]);
      }
    });
    return () => {
      active = false;
    };
  }, [client, selection]);

  return (
    <EncounterBundlePromotionPanel
      selection={selection}
      previewBlockers={previewBlockers}
      previewAttestations={previewAttestations}
      submitStatus={submitStatus}
      submitMessage={submitMessage}
      launchIdentity={launchIdentity}
      onPromote={async (nextSelection) => {
        setSubmitStatus("submitting");
        setSubmitMessage(undefined);
        try {
          const result = await client.promoteFacultyEncounterBundle(nextSelection);
          if (!result.promoted || result.learnerLaunchIdentity === null) {
            setPreviewBlockers(result.blockers ?? ["promotion_refused"]);
            setSubmitStatus("error");
            setSubmitMessage("Promotion refused");
            setLaunchIdentity(null);
            return;
          }
          setLaunchIdentity(result.learnerLaunchIdentity);
          setSubmitStatus("submitted");
        } catch (error: unknown) {
          setSubmitStatus("error");
          setSubmitMessage(error instanceof Error ? error.message : "promotion_failed");
        }
      }}
    />
  );
}
