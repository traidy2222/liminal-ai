# Distributed Knowledge Management System - Terminology Glossary

## Overview
This glossary defines technical terms, acronyms, and domain-specific vocabulary for the Distributed Knowledge Management System (DKMS). All terms are defined to ensure precision and consistency across documentation.

## Core Concepts

### **Distributed Knowledge Management System (DKMS)**
A decentralized system that enables multiple nodes to store, share, and synchronize knowledge artifacts across a network without centralized control.

### **Knowledge Artifact**
Any discrete unit of information stored in the system, including documents, concepts, relationships, metadata, or derived insights.

### **Node**
An individual server or service instance that participates in the distributed network, maintaining local knowledge stores and facilitating peer-to-peer synchronization.

### **Graph Database**
A database that uses nodes and edges to represent and query relationships between knowledge artifacts, optimized for connected data traversal.

### **Knowledge Graph**
The global network of interconnected knowledge artifacts spanning all participating nodes, represented as a directed acyclic graph (DAG) with semantic relationships.

## Architecture Terms

### **Federation Layer**
The network protocol layer responsible for node discovery, peer management, and distributed consensus on knowledge state.

### **Consensus Protocol**
A variant of Raft consensus adapted for knowledge synchronization, ensuring all nodes agree on the canonical state of shared knowledge artifacts.

### **Vector Clock**
A logical timestamp mechanism used to track causality between knowledge updates across distributed nodes, enabling conflict detection and resolution.

### **Content-Addressable Storage (CAS)**
A storage model where data objects are referenced by cryptographic hashes of their content, ensuring immutability and deduplication.

### **Sharding Key**
An attribute used to partition knowledge artifacts across nodes, typically based on domain, creation date, or access patterns.

### **Replication Factor**
The number of nodes that maintain copies of each knowledge artifact for fault tolerance and availability.

### **Vector Embedding**
A dense numerical vector representation of knowledge artifacts in latent semantic space, enabling similarity search and machine learning operations.

## API Terms

### **Artifact ID**
A unique identifier for a knowledge artifact, typically a UUIDv5 derived from the artifact's content hash and namespace.

### **Semantic Version**
A version identifier following the pattern `major.minor.patch` where major versions indicate breaking schema changes, minor versions add backward-compatible features, and patch versions fix bugs.

### **Query DSL**
Domain-specific language for expressing complex knowledge queries, supporting graph traversal, filtering, aggregation, and vector similarity operations.

### **Stream Cursor**
An opaque token returned by paginated API responses, enabling clients to retrieve subsequent pages of results.

### **Webhook Signature**
A cryptographic signature header (HMAC-SHA256) attached to webhook payloads, allowing recipients to verify the authenticity and integrity of incoming notifications.

### **Rate Limit Window**
A time interval (typically 60 seconds) over which API request quotas are measured and enforced.

## Constraint Terms

### **Eventual Consistency Window**
The maximum time (default: 5 seconds) allowed for knowledge updates to propagate between nodes before being considered committed to the global knowledge graph.

### **Cold Storage Threshold**
The size limit (default: 100MB) above which artifacts are automatically migrated to cost-optimized cold storage with reduced retrieval latency.

### **Active Memory Limit**
The maximum memory (default: 8GB) a node can consume for caching frequently-accessed knowledge artifacts.

### **Compliance Mode**
A system configuration where all knowledge artifacts must pass predefined regulatory checks (GDPR, HIPAA, SOX) before being stored or shared.

### **Air-Gap Requirement**
A security constraint preventing knowledge artifacts from being transmitted outside trusted network boundaries without explicit approval.

## Data Types

### **Scalar Types**
- `string`: UTF-8 text
- `number`: 64-bit floating point
- `boolean`: true/false value
- `timestamp`: RFC 3339 UTC timestamp
- `binary`: Base64-encoded content

### **Complex Types**
- `Artifact`: Structured knowledge container
- `Relationship`: Directed edge between artifacts
- `Vector`: Fixed-length numerical array
- `Metadata`: Key-value attribute map

## Relationship Types

### **Semantic Relationships**
- `IS_A`: Classification relationship
- `PART_OF`: Hierarchical containment
- `RELATED_TO`: Associative relationship
- `DEPENDS_ON`: Dependency relationship
- `DERIVED_FROM`: Provenance relationship

## Operational Terms

### **Node Health Score**
A composite metric (0.0-1.0) reflecting node availability, sync status, and resource utilization.

### **Knowledge Drift**
The divergence in knowledge state between nodes, measured as the count of unsynchronized artifact versions.

### **Graceful Degradation**
The system's ability to continue operating with reduced functionality when nodes are offline or under resource pressure.