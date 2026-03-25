package org.egov.pgr.service;


import com.jayway.jsonpath.JsonPath;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.tracer.model.CustomException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.egov.pgr.util.PGRConstants.MDMS_DEPARTMENT_SEARCH;

@org.springframework.stereotype.Service
public class PGRService {

    private static final Logger log = LoggerFactory.getLogger(PGRService.class);
    private static final ExecutorService VIRTUAL = Executors.newVirtualThreadPerTaskExecutor();

    private EnrichmentService enrichmentService;

    private UserService userService;

    private WorkflowService workflowService;

    private ServiceRequestValidator serviceRequestValidator;

    private ServiceRequestValidator validator;

    private Producer producer;

    private PGRConfiguration config;

    private PGRRepository repository;

    private MDMSUtils mdmsUtils;


    @Autowired
    public PGRService(EnrichmentService enrichmentService, UserService userService, WorkflowService workflowService,
                      ServiceRequestValidator serviceRequestValidator, ServiceRequestValidator validator, Producer producer,
                      PGRConfiguration config, PGRRepository repository, MDMSUtils mdmsUtils) {
        this.enrichmentService = enrichmentService;
        this.userService = userService;
        this.workflowService = workflowService;
        this.serviceRequestValidator = serviceRequestValidator;
        this.validator = validator;
        this.producer = producer;
        this.config = config;
        this.repository = repository;
        this.mdmsUtils = mdmsUtils;
    }


    /**
     * Creates a complaint in the system
     * @param request The service request containg the complaint information
     * @return
     */
    public ServiceRequest create(ServiceRequest request){
        long t0 = System.nanoTime();
        String tenantId = request.getService().getTenantId();
        Object mdmsData = mdmsUtils.mDMSCall(request);
        long t1 = System.nanoTime();
        validator.validateCreate(request, mdmsData);
        long t2 = System.nanoTime();
        enrichmentService.enrichCreateRequest(request);
        long t3 = System.nanoTime();
        workflowService.updateWorkflowStatus(request);
        long t4 = System.nanoTime();

        Service service = request.getService();
        Map<String, Object> additionalDetailMap = new HashMap<>();
        additionalDetailMap.put("department", getDepartmentFromMDMS(request, mdmsData));
        service.setAdditionalDetail(additionalDetailMap);

        producer.push(tenantId,config.getCreateTopic(),request);
        producer.push(tenantId,config.getInboxCreateTopic(),request);
        long t5 = System.nanoTime();
        log.info("TIMING CREATE total={}ms mdms={}ms validate={}ms enrich={}ms workflow={}ms kafka={}ms",
            (t5-t0)/1_000_000, (t1-t0)/1_000_000, (t2-t1)/1_000_000,
            (t3-t2)/1_000_000, (t4-t3)/1_000_000, (t5-t4)/1_000_000);
        return request;
    }


    /**
     * Searches the complaints in the system based on the given criteria
     * @param requestInfo The requestInfo of the search call
     * @param criteria The search criteria containg the params on which to search
     * @return
     */
    public List<ServiceWrapper> search(RequestInfo requestInfo, RequestSearchCriteria criteria){
        long t0 = System.nanoTime();
        validator.validateSearch(requestInfo, criteria);

        enrichmentService.enrichSearchRequest(requestInfo, criteria);

        if(criteria.isEmpty())
            return new ArrayList<>();

        if(criteria.getMobileNumber()!=null && CollectionUtils.isEmpty(criteria.getUserIds()))
            return new ArrayList<>();

        criteria.setIsPlainSearch(false);

        long t1 = System.nanoTime();
        List<ServiceWrapper> serviceWrappers = repository.getServiceWrappers(criteria);
        long t2 = System.nanoTime();

        if(CollectionUtils.isEmpty(serviceWrappers))
            return new ArrayList<>();;

        // Enrich users and workflow in parallel — they are independent
        long[] usersMs = {0}, wfMs = {0};
        CompletableFuture<Void> usersFuture = CompletableFuture.runAsync(() -> {
            long s = System.nanoTime();
            userService.enrichUsers(serviceWrappers);
            usersMs[0] = (System.nanoTime() - s) / 1_000_000;
        }, VIRTUAL);
        CompletableFuture<List<ServiceWrapper>> workflowFuture = CompletableFuture.supplyAsync(() -> {
            long s = System.nanoTime();
            List<ServiceWrapper> result = workflowService.enrichWorkflow(requestInfo, serviceWrappers);
            wfMs[0] = (System.nanoTime() - s) / 1_000_000;
            return result;
        }, VIRTUAL);

        try {
            usersFuture.join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw new CustomException("ENRICH_ERROR", e.getCause().getMessage());
        }

        List<ServiceWrapper> enrichedServiceWrappers;
        try {
            enrichedServiceWrappers = workflowFuture.join();
        } catch (CompletionException e) {
            if (e.getCause() instanceof RuntimeException re) throw re;
            throw new CustomException("WORKFLOW_ENRICH_ERROR", e.getCause().getMessage());
        }
        log.info("TIMING SEARCH_ENRICH users={}ms workflow={}ms", usersMs[0], wfMs[0]);
        long t3 = System.nanoTime();
        Map<Long, List<ServiceWrapper>> sortedWrappers = new TreeMap<>(Collections.reverseOrder());
        for(ServiceWrapper svc : enrichedServiceWrappers){
            if(sortedWrappers.containsKey(svc.getService().getAuditDetails().getCreatedTime())){
                sortedWrappers.get(svc.getService().getAuditDetails().getCreatedTime()).add(svc);
            }else{
                List<ServiceWrapper> serviceWrapperList = new ArrayList<>();
                serviceWrapperList.add(svc);
                sortedWrappers.put(svc.getService().getAuditDetails().getCreatedTime(), serviceWrapperList);
            }
        }
        List<ServiceWrapper> sortedServiceWrappers = new ArrayList<>();
        for(Long createdTimeDesc : sortedWrappers.keySet()){
            sortedServiceWrappers.addAll(sortedWrappers.get(createdTimeDesc));
        }
        long t4 = System.nanoTime();
        log.info("TIMING SEARCH total={}ms validate+enrich={}ms db={}ms user+workflow={}ms sort={}ms",
            (t4-t0)/1_000_000, (t1-t0)/1_000_000, (t2-t1)/1_000_000,
            (t3-t2)/1_000_000, (t4-t3)/1_000_000);
        return sortedServiceWrappers;
    }


    /**
     * Updates the complaint (used to forward the complaint from one application status to another)
     * @param request The request containing the complaint to be updated
     * @return
     */
    public ServiceRequest update(ServiceRequest request){
        long t0 = System.nanoTime();
        String tenantId = request.getService().getTenantId();
        Object mdmsData = mdmsUtils.mDMSCall(request);
        long t1 = System.nanoTime();
        validator.validateUpdate(request, mdmsData);
        long t2 = System.nanoTime();
        enrichmentService.enrichUpdateRequest(request);
        long t3 = System.nanoTime();
        workflowService.updateWorkflowStatus(request);
        long t4 = System.nanoTime();
        producer.push(tenantId,config.getUpdateTopic(),request);
        producer.push(tenantId,config.getInboxUpdateTopic(),request);
        long t5 = System.nanoTime();
        log.info("TIMING UPDATE total={}ms mdms={}ms validate={}ms enrich={}ms workflow={}ms kafka={}ms",
            (t5-t0)/1_000_000, (t1-t0)/1_000_000, (t2-t1)/1_000_000,
            (t3-t2)/1_000_000, (t4-t3)/1_000_000, (t5-t4)/1_000_000);
        return request;
    }

    /**
     * Returns the total number of comaplaints matching the given criteria
     * @param requestInfo The requestInfo of the search call
     * @param criteria The search criteria containg the params for which count is required
     * @return
     */
    public Integer count(RequestInfo requestInfo, RequestSearchCriteria criteria){
        criteria.setIsPlainSearch(false);
        Integer count = repository.getCount(criteria);
        return count;
    }


    public List<ServiceWrapper> plainSearch(RequestInfo requestInfo, RequestSearchCriteria criteria) {
        validator.validatePlainSearch(criteria);

        criteria.setIsPlainSearch(true);

        if(criteria.getLimit()==null)
            criteria.setLimit(config.getDefaultLimit());

        if(criteria.getOffset()==null)
            criteria.setOffset(config.getDefaultOffset());

        if(criteria.getLimit()!=null && criteria.getLimit() > config.getMaxLimit())
            criteria.setLimit(config.getMaxLimit());

        List<ServiceWrapper> serviceWrappers = repository.getServiceWrappers(criteria);

        if(CollectionUtils.isEmpty(serviceWrappers)){
            return new ArrayList<>();
        }

        userService.enrichUsers(serviceWrappers);
        List<ServiceWrapper> enrichedServiceWrappers = workflowService.enrichWorkflow(requestInfo, serviceWrappers);

        Map<Long, List<ServiceWrapper>> sortedWrappers = new TreeMap<>(Collections.reverseOrder());
        for(ServiceWrapper svc : enrichedServiceWrappers){
            if(sortedWrappers.containsKey(svc.getService().getAuditDetails().getCreatedTime())){
                sortedWrappers.get(svc.getService().getAuditDetails().getCreatedTime()).add(svc);
            }else{
                List<ServiceWrapper> serviceWrapperList = new ArrayList<>();
                serviceWrapperList.add(svc);
                sortedWrappers.put(svc.getService().getAuditDetails().getCreatedTime(), serviceWrapperList);
            }
        }
        List<ServiceWrapper> sortedServiceWrappers = new ArrayList<>();
        for(Long createdTimeDesc : sortedWrappers.keySet()){
            sortedServiceWrappers.addAll(sortedWrappers.get(createdTimeDesc));
        }
        return sortedServiceWrappers;
    }


	public Map<String, Integer> getDynamicData(String tenantId) {
		
		Map<String,Integer> dynamicData = repository.fetchDynamicData(tenantId);

		return dynamicData;
	}


	public int getComplaintTypes() {
		
		return Integer.valueOf(config.getComplaintTypes());
	}

    private String getDepartmentFromMDMS(ServiceRequest request, Object mdmsData) {

        String serviceCode = request.getService().getServiceCode();
        String jsonPath = MDMS_DEPARTMENT_SEARCH.replace("{SERVICEDEF}", serviceCode);

        try {
            List<String> department = JsonPath.read(mdmsData, jsonPath);

            if (department == null || department.isEmpty()) {
                throw new CustomException("DEPARTMENT_NOT_FOUND", "No department found for service: " + serviceCode);
            }

            return department.get(0);
        } catch (Exception e) {
            throw new CustomException("JSONPATH_ERROR", "Failed to parse mdms response for service: " + serviceCode);
        }
    }

}
