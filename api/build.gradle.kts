plugins {
	java
	id("org.springframework.boot") version "4.0.6"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "com.helpdoit"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

extra["springAiVersion"] = "2.0.0-M8"

dependencyManagement {
	imports {
		mavenBom("org.springframework.ai:spring-ai-bom:${property("springAiVersion")}")
	}
}

dependencies {
	// --- AI (Spring AI 2.0 — the Spring Boot 4 line) ---
	// Chat providers — all three loaded; enablement is key-driven (see AiProvidersConfig).
	// OpenAI starter also drives OpenAI-compatible providers (OpenRouter) via base-url.
	implementation("org.springframework.ai:spring-ai-starter-model-openai")
	implementation("org.springframework.ai:spring-ai-starter-model-anthropic")
	implementation("org.springframework.ai:spring-ai-starter-model-ollama")
	// pgvector vector store for the RAG knowledge corpus.
	implementation("org.springframework.ai:spring-ai-starter-vector-store-pgvector")

	implementation("org.springframework.boot:spring-boot-starter-actuator")
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	implementation("org.springframework.boot:spring-boot-starter-flyway")
	implementation("org.springframework.boot:spring-boot-starter-graphql")
	// RSocket — bidirectional channel for the extension (own WS server on port 8081).
	implementation("org.springframework.boot:spring-boot-starter-rsocket")
	// Auth — server-side OIDC login (provider-agnostic) + resource server validating our app JWT.
	implementation("org.springframework.boot:spring-boot-starter-oauth2-client")
	implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
	implementation("org.springframework.boot:spring-boot-starter-validation")
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.flywaydb:flyway-database-postgresql")
	implementation("com.graphql-java:graphql-java-extended-scalars:24.0")
	// Attachment conversion: Tika extracts text from PDFs/Office/RTF/HTML/etc. and
	// sniffs MIME types (bundles PDFBox + POI). Images are handled via ImageIO.
	implementation("org.apache.tika:tika-core:2.9.2")
	implementation("org.apache.tika:tika-parsers-standard-package:2.9.2")
	compileOnly("org.projectlombok:lombok")
	developmentOnly("org.springframework.boot:spring-boot-devtools")
	runtimeOnly("org.postgresql:postgresql")
	annotationProcessor("org.projectlombok:lombok")
	testImplementation("org.springframework.boot:spring-boot-starter-actuator-test")
	testImplementation("org.springframework.boot:spring-boot-starter-data-jpa-test")
	testImplementation("org.springframework.boot:spring-boot-starter-flyway-test")
	testImplementation("org.springframework.boot:spring-boot-starter-graphql-test")
	testImplementation("org.springframework.boot:spring-boot-starter-validation-test")
	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testCompileOnly("org.projectlombok:lombok")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
	testAnnotationProcessor("org.projectlombok:lombok")
}

tasks.withType<Test> {
	useJUnitPlatform()
}
