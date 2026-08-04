package com.helpdoit.graphql.error;

/** Thrown by services when a referenced entity does not exist. */
public class NotFoundException extends RuntimeException {
    public NotFoundException(String what) {
        super(what + " not found");
    }
}
