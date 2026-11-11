// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Issuer-controlled registry for synthetic credential commitments.
contract CredentialRegistrySecure {
    struct Credential {
        address subject;
        address issuer;
        uint64 expiresAt;
        bool revoked;
        bool exists;
    }

    address public immutable administrator;
    mapping(address => bool) public authorizedIssuers;
    mapping(bytes32 => Credential) private credentials;

    event IssuerAuthorizationChanged(address indexed issuer, bool authorized);
    event CredentialIssued(bytes32 indexed credentialId, address indexed subject, address indexed issuer);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed actor);

    modifier onlyAdministrator() {
        require(msg.sender == administrator, "Not registry administrator");
        _;
    }

    modifier onlyIssuer() {
        require(authorizedIssuers[msg.sender], "Not authorized issuer");
        _;
    }

    constructor() {
        administrator = msg.sender;
        authorizedIssuers[msg.sender] = true;
        emit IssuerAuthorizationChanged(msg.sender, true);
    }

    function setIssuer(address issuer, bool authorized) external onlyAdministrator {
        require(issuer != address(0), "Invalid issuer");
        authorizedIssuers[issuer] = authorized;
        emit IssuerAuthorizationChanged(issuer, authorized);
    }

    function issueCredential(bytes32 credentialId, address subject, uint64 expiresAt)
        external
        onlyIssuer
    {
        require(credentialId != bytes32(0), "Invalid credential hash");
        require(subject != address(0), "Invalid subject");
        require(expiresAt > block.timestamp, "Credential already expired");
        require(!credentials[credentialId].exists, "Credential already exists");

        credentials[credentialId] = Credential(subject, msg.sender, expiresAt, false, true);
        emit CredentialIssued(credentialId, subject, msg.sender);
    }

    function revokeCredential(bytes32 credentialId) external {
        Credential storage credential = credentials[credentialId];
        require(credential.exists, "Credential does not exist");
        require(
            msg.sender == administrator || msg.sender == credential.issuer,
            "Not credential issuer"
        );
        require(!credential.revoked, "Credential already revoked");

        credential.revoked = true;
        emit CredentialRevoked(credentialId, msg.sender);
    }

    function verifyCredential(bytes32 credentialId) external view returns (bool) {
        Credential storage credential = credentials[credentialId];
        return credential.exists && !credential.revoked && block.timestamp < credential.expiresAt;
    }

    function getCredential(bytes32 credentialId)
        external
        view
        returns (address subject, address issuer, uint64 expiresAt, bool revoked, bool exists)
    {
        Credential storage credential = credentials[credentialId];
        return (
            credential.subject,
            credential.issuer,
            credential.expiresAt,
            credential.revoked,
            credential.exists
        );
    }
}