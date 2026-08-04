package com.helpdoit;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling   // drives the TaskRunner poll loop
public class HelpdoApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(HelpdoApiApplication.class, args);
	}

}
