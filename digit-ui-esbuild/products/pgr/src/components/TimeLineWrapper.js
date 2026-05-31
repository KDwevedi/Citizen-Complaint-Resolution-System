import React, { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import { PopUp, Timeline, TimelineMolecule, Loader } from '@egovernments/digit-ui-components';
import { useMyContext } from "../utils/context";
import { convertEpochFormateToDate } from '../utils';

const TimelineWrapper = ({ businessId, isWorkFlowLoading, workflowData, labelPrefix = "" }) => {
    const { state } = useMyContext();
    const { t } = useTranslation();

    const tenantId = Digit.ULBService.getCurrentTenantId();

    // Manage timeline data
    const [timelineSteps, setTimelineSteps] = useState([]);

    useEffect(() => {
        if (workflowData && workflowData.ProcessInstances) {
            // ASSIGN / ESCALATE move the complaint to a new assignee
            // (ESCALATE via the auto-escalator picking the next-level
            // employee), so the timeline row should show that assignee
            // (instance.assignes[0]) not the actor who performed the action
            // (instance.assigner). egovernments/CCRS#490 originally listed
            // ASSIGN / REASSIGN; ESCALATE shipped after and inherits the
            // same intent.
            //
            // REASSIGN is special-cased below: per Nairobi spec we surface
            // the upstream GRO (the assigner of the prior ASSIGN row), not
            // the LME who pressed Reassign and not the next LME being
            // assigned. That makes the timeline read "GRO routed this
            // reassign", which is what reviewers expect. CCRS#490 sub-bug 3.
            const isAssigningAction = (action) =>
                action === "ASSIGN" || action === "ESCALATE";

            // Just the person's name. The prior implementation appended the
            // localized role list as " - <role1>, <role2>, ..." which for
            // admin-tier users with 8 roles produced an unreadable wall of
            // text on every timeline row (egovernments/CCRS#524). The row
            // label already describes the action (ASSIGN / REJECT / etc.),
            // so role context isn't needed in the caption. CS_NA fallback
            // so a missing assignee renders "NA" instead of silently
            // dropping the row caption (CCRS#490 sub-bug 4).
            const formatPerson = (person) => {
                if (!person?.name) return t("CS_NA");
                return person.name;
            };

            // Reject-action audit comments come from the reject modal as
            // "[<CODE>] <free text>" (e.g. "[NOT_PUBLIC_INFRA] sfdgdsfg").
            // When the [CODE] resolves to a `CS_REJECTION__<CODE>`
            // localization key, surface the localized reason and append
            // any trailing free text after an em-dash. Falls back to the
            // existing "Employee Comments: \"...\"" framing for any other
            // comment shape (egovernments/CCRS#489).
            const formatComment = (raw) => {
                if (typeof raw !== "string" || raw.length === 0) return null;
                const match = raw.match(/^\[([A-Z_][A-Z0-9_]*)\]\s*(.*)$/s);
                if (match) {
                    const reasonKey = `CS_REJECTION__${match[1]}`;
                    const reasonLabel = t(reasonKey);
                    if (reasonLabel && reasonLabel !== reasonKey) {
                        const trailing = (match[2] || "").trim();
                        return trailing
                            ? `${t("CS_REJECT_COMPLAINT")}: ${reasonLabel} — ${trailing}`
                            : `${t("CS_REJECT_COMPLAINT")}: ${reasonLabel}`;
                    }
                }
                return `${t('CS_COMMON_EMPLOYEE_COMMENTS')} : "${raw}"`;
            };

            // Map API response to timeline steps.
            //
            // egov-workflow-v2 /process/_search?history=true returns
            // ProcessInstances NEWEST-FIRST: ProcessInstances[0] is the
            // current state (verified by surrounding code — e.g.
            // services/workflow/Workflow.js reads
            // `processInstances[0].nextActions` as the live next-actions
            // set, and pages/employee/PGRDetails.js treats
            // `ProcessInstances[0].state` as the current state). The
            // older instances follow at higher indices, so the previous
            // (earlier) instance is `arr[index + 1]`.
            const steps = workflowData.ProcessInstances.map((instance, index, arr) => {
                const assignee = instance?.assignes?.[0];
                const previous = arr[index + 1];
                let personRecord;
                let mobile;
                if (instance?.action === "REASSIGN") {
                    // Show the upstream GRO (the assigner of the prior
                    // ASSIGN row). Fall back to the REASSIGN's own assigner
                    // if for any reason the prior instance is missing —
                    // better to show the LME who pressed Reassign than to
                    // render "NA".
                    personRecord = previous?.assigner ?? instance?.assigner;
                    mobile = previous?.assigner?.mobileNumber ?? instance?.assigner?.mobileNumber;
                } else if (isAssigningAction(instance?.action)) {
                    personRecord = assignee;
                    mobile = assignee?.mobileNumber;
                } else {
                    personRecord = instance?.assigner;
                    mobile = instance?.assigner?.mobileNumber;
                }
                const personLine = formatPerson(personRecord);
                const contactLine = mobile ? `${t("ES_COMMON_CONTACT_DETAILS")}: ${mobile}` : null;

                return {
                    label: t(`${labelPrefix}${instance?.action}`),
                    variant: 'completed',
                    subElements: [
                        convertEpochFormateToDate(instance?.auditDetails?.lastModifiedTime),
                        personLine,
                        contactLine,
                        formatComment(instance?.comment),
                    ].filter(Boolean),
                    showConnector: true,
                };
            });
            setTimelineSteps(steps);
        }
    }, [workflowData]);

    return (
        isWorkFlowLoading ? <Loader /> :
            <TimelineMolecule key="timeline" initialVisibleCount={4} hidePastLabel={timelineSteps.length < 5}>
                {timelineSteps.map((step, index) => (
                    <Timeline
                        key={index}
                        label={step.label}
                        subElements={step.subElements}
                        variant={step.variant}
                        showConnector={step.showConnector}
                    />
                ))}
            </TimelineMolecule>
    );
};

export default TimelineWrapper;
