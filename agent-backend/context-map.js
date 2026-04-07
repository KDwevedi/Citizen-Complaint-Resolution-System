/**
 * Static mapping of routes to the PGR component files that render them.
 * Used to give Claude targeted context about which files to edit.
 */

const PGR_SRC = "frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src";

const ROUTE_COMPONENTS = {
  "/employee/pgr/inbox-v2": {
    description: "Employee complaint inbox - search, filter, and list complaints",
    files: [
      PGR_SRC + "/pages/employee/PGRInbox.js",
      PGR_SRC + "/configs/PGRSearchInboxConfig.js",
      PGR_SRC + "/configs/UICustomizations.js",
    ],
  },
  "/employee/pgr/create-complaint": {
    description: "Employee create complaint form",
    files: [
      PGR_SRC + "/pages/employee/CreateComplaint/index.js",
      PGR_SRC + "/configs/CreateComplaintConfig.js",
      PGR_SRC + "/components/BoundaryComponent.js",
      PGR_SRC + "/components/GeoLocations.js",
    ],
  },
  "/employee/pgr/complaint-details": {
    description: "Employee complaint detail view - timeline, assignment, workflow actions",
    files: [
      PGR_SRC + "/pages/employee/PGRDetails.js",
      PGR_SRC + "/components/TimeLine.js",
      PGR_SRC + "/components/TimeLineWrapper.js",
      PGR_SRC + "/components/Complaint.js",
      PGR_SRC + "/components/AssigneeComponent.js",
      PGR_SRC + "/components/PGRWorkflowModal.js",
      PGR_SRC + "/components/ComplaintPhotos.js",
    ],
  },
  "/citizen/pgr/complaints": {
    description: "Citizen complaint list",
    files: [
      PGR_SRC + "/pages/citizen/ComplaintsList.js",
    ],
  },
  "/citizen/pgr/create-complaint": {
    description: "Citizen create complaint flow - multi-step form",
    files: [
      PGR_SRC + "/pages/citizen/Create/FormExplorer.js",
    ],
  },
  "/citizen/pgr/complaint/details": {
    description: "Citizen complaint detail view",
    files: [
      PGR_SRC + "/pages/citizen/ComplaintDetails.js",
    ],
  },
};

// Shared files that are relevant regardless of route
const SHARED_FILES = [
  PGR_SRC + "/Module.js",
  PGR_SRC + "/services/pgr/PGRService.js",
  PGR_SRC + "/utils/index.js",
  PGR_SRC + "/utils/constants.js",
  PGR_SRC + "/utils/urls.js",
  PGR_SRC + "/redux/actions/complaint.js",
  PGR_SRC + "/redux/reducers/complaintReducer.js",
];

function resolveContext(currentRoute) {
  // Find the best matching route
  let bestMatch = null;
  let bestLen = 0;
  for (const pattern of Object.keys(ROUTE_COMPONENTS)) {
    if (currentRoute.includes(pattern) && pattern.length > bestLen) {
      bestMatch = pattern;
      bestLen = pattern.length;
    }
  }

  const routeInfo = bestMatch ? ROUTE_COMPONENTS[bestMatch] : null;
  return {
    matchedRoute: bestMatch,
    description: routeInfo ? routeInfo.description : "Unknown page",
    relevantFiles: routeInfo ? routeInfo.files : [],
    sharedFiles: SHARED_FILES,
  };
}

module.exports = { resolveContext, ROUTE_COMPONENTS, SHARED_FILES, PGR_SRC };
