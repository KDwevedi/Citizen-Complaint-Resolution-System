package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Uses the real {@link AccessPolicyRegistry} and real {@link PolicyEvaluator}, with only the
 * outbound access-control source replaced with a deterministic role-scoped source returning the
 * same JsonLogic condition shipped in ACCESSCONTROL-ACTIONS-TEST.actions-test (id 2008) — so this
 * exercises the actual condition contract, not a stand-in. Only
 * {@link org.egov.pgr.analytics.PrincipalScopeResolver} is out of scope here (it makes an HRMS
 * call) — scope is constructed directly per test instead.
 */
class SearchAccessPolicyServiceTest {

    private static final String TENANT_ID = "pg.city";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SearchAccessPolicyService service;

    @BeforeEach
    void setup() {
        Map<String, Object> condition = Map.of(
                "or", List.of(
                        Map.of("==", List.of(Map.of("var", "user.attributes.tenantWide"), true)),
                        Map.of("and", List.of(
                                Map.of("==", List.of(Map.of("var", "user.type"), "CITIZEN")),
                                Map.of("==", List.of(Map.of("var", "resource.complaint.accountId"), Map.of("var", "user.uuid")))
                        )),
                        Map.of("and", List.of(
                                Map.of("==", List.of(Map.of("var", "user.type"), "EMPLOYEE")),
                                Map.of("in", List.of(Map.of("var", "resource.complaint.department"), Map.of("var", "user.attributes.departments")))
                        ))
                ));
        PolicyAction action = new PolicyAction("POST", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                        "method", "POST", "condition", condition));
        AccessPolicyRegistry registry = new AccessPolicyRegistry((tenantId, method, url, roles) ->
                TENANT_ID.equals(tenantId) ? List.of(action) : List.of());
        service = new SearchAccessPolicyService(null, registry,
                new PolicyEvaluator(new ObjectMapper()), new PolicyInputBuilder());
    }

    @Test
    void citizenScopeKeepsOnlyTheirOwnComplaint() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, "citizen-1", null, null);
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN");

        ServiceWrapper own = wrapper("citizen-1", "NA", "WARD_5", TENANT_ID);
        ServiceWrapper someoneElses = wrapper("citizen-2", "NA", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(own, someoneElses));

        assertEquals(1, result.size());
        assertEquals("citizen-1", result.get(0).getService().getAccountId());
    }

    /**
     * wrapper() builds additionalDetail as a JsonNode (matching PGRRowMapper's real shape, not a
     * plain Map) — this is what actually caught the extractDepartment() bug that only checked
     * `instanceof Map` and silently returned null for every department-scoped check on real
     * search results.
     */
    @Test
    void employeeScopeKeepsMatchingDepartmentAcrossLocalities() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("SANITATION"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard5 = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper sanitationWard9 = wrapper("citizen-2", "SANITATION", "WARD_9", TENANT_ID);
        ServiceWrapper roadsWard5 = wrapper("citizen-2", "ROADS", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope,
                List.of(sanitationWard5, sanitationWard9, roadsWard5));

        assertEquals(2, result.size());
        assertEquals("SANITATION", ((JsonNode) result.get(0).getService().getAdditionalDetail()).get("department").asText());
        assertEquals("SANITATION", ((JsonNode) result.get(1).getService().getAdditionalDetail()).get("department").asText());
    }

    @Test
    void tenantWideScopeKeepsEverythingRegardlessOfDepartment() {
        AnalyticsScope scope = AnalyticsScope.tenantWide(TENANT_ID, false);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper b = wrapper("citizen-2", "ROADS", "WARD_9", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a, b));

        assertEquals(2, result.size());
    }

    @Test
    void arbitraryEmptyScopeDoesNotBecomeTenantWide() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, null);
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper complaint = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(complaint));

        assertTrue(result.isEmpty());
    }

    @Test
    void failClosedSentinelScopeDropsEverything() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("__scope_denied__"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a));

        assertTrue(result.isEmpty());
    }

    @Test
    void mdmsUnavailableFailsClosedAndDropsEverything() {
        AnalyticsScope scope = new AnalyticsScope("ke.nairobi", false, null, null, null);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", "ke.nairobi");

        List<ServiceWrapper> result = service.enforce(requestInfo, "ke.nairobi", scope, List.of(a));

        assertTrue(result.isEmpty());
    }

    private RequestInfo requestInfo(String uuid, String type) {
        User user = new User();
        user.setUuid(uuid);
        user.setType(type);
        user.setRoles(List.of(Role.builder().code(type).build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    /** Builds additionalDetail as a JsonNode, matching PGRRowMapper's real shape (not a plain Map). */
    private ServiceWrapper wrapper(String accountId, String department, String boundary, String tenantId) {
        Address address = Address.builder().tenantId(tenantId).locality(Boundary.builder().code(boundary).build()).build();
        Service service = Service.builder()
                .accountId(accountId)
                .tenantId(tenantId)
                .additionalDetail(MAPPER.createObjectNode().put("department", department))
                .address(address)
                .build();
        return ServiceWrapper.builder().service(service).build();
    }
}
