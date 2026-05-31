import { TelePhone, CheckPoint } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";

const PendingAtLME = ({ name, isCompleted, mobile, text, customChild }) => {
  let { t } = useTranslation();
  // `text` is an optional prefix (kept for backward compatibility); when
  // the caller already renders the status label outside (TimeLine.js does),
  // it should pass text="" so we don't print "Pending at LME Lionel" under
  // the existing "Pending at LME" header (issue CCRS#490).
  //
  // CCRS#490 sub-bug 5 verification (2026-05-31): the only place that
  // emits a "Pending at LME" string in the pgr products tree is the
  // `<CheckPoint label={t("CS_COMMON_PENDINGATLME")} ... />` below —
  // grepped CS_COMMON_PENDINGATLME and PENDINGATLME across
  // digit-ui-esbuild/products/pgr/src, confirmed single source. The
  // duplication reported on the citizen view could not be reproduced
  // from code inspection alone (TimeLine.js#PENDINGATLME passes text=""
  // already). Leaving this as a code-side no-op; flag to Nairobi QA to
  // re-test on the citizen view post-deploy and reopen with a
  // screenshot + tenant if the duplicate persists.
  const displayText = text ? `${text} ${name}` : name;
  return <CheckPoint label={t("CS_COMMON_PENDINGATLME")} isCompleted={isCompleted} customChild={
          <div>
            {name && mobile ? <TelePhone mobile={mobile} text={displayText}/> : null }
            {customChild}
          </div>
        } />
};

export default PendingAtLME;
