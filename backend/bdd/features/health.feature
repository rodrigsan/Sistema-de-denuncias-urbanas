Feature: Health check of the API
  As a developer of the system
  I want to verify that the health service responds correctly
  To confirm that the API is operational

  Scenario: Check the health endpoint and receive ok status
    Given the API server is running
    When I query the endpoint "/api/v1/health"
    Then the response code is 200
    And the body responds with status "ok"
    And the service name is "denuncias-cercado-api"
