package com.helpdoit.graphql;

import com.helpdoit.graphql.error.NotFoundException;
import graphql.GraphQLError;
import graphql.schema.DataFetchingEnvironment;
import org.springframework.graphql.execution.DataFetcherExceptionResolverAdapter;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.stereotype.Component;

/** Maps service-layer exceptions to GraphQL error responses. */
@Component
class GraphqlExceptionResolver extends DataFetcherExceptionResolverAdapter {

    @Override
    protected GraphQLError resolveToSingleError(Throwable ex, DataFetchingEnvironment env) {
        if (ex instanceof NotFoundException nfe) {
            return GraphQLError.newError()
                .errorType(ErrorType.NOT_FOUND)
                .message(nfe.getMessage())
                .path(env.getExecutionStepInfo().getPath())
                .location(env.getField().getSourceLocation())
                .build();
        }
        if (ex instanceof IllegalArgumentException iae) {
            return GraphQLError.newError()
                .errorType(ErrorType.BAD_REQUEST)
                .message(iae.getMessage())
                .path(env.getExecutionStepInfo().getPath())
                .location(env.getField().getSourceLocation())
                .build();
        }
        return null; // let default handler take over
    }
}
