import { OEOCImpactApp } from "@/components/apps/OEOCImpactApp";
import { getWorkLocationMarkers } from "@/lib/workLocations";

export const dynamic = "force-dynamic";

export default async function OEOCImpactPage() {
  try {
    const payload = await getWorkLocationMarkers();

    return (
      <OEOCImpactApp
        initialDataSource={payload.snapshot ? "snapshot" : "live"}
        initialDataWarning={payload.warning}
        initialMarkers={payload.markers}
        initialSkippedRows={payload.skippedRows}
        initialUpdatedAt={payload.updatedAt}
      />
    );
  } catch {
    return <OEOCImpactApp initialLoadError initialMarkers={[]} initialSkippedRows={0} />;
  }
}
