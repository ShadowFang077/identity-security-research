// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Intentionally insecure teaching contract. Never deploy to a public network.
contract CredentialRegistryVulnerable {
    struct Credential {
        address subject;
        address issuer;
        uint64 expiresAt;
        bool revoked;
        bool exists;
    }

    mapping(bytes32 => Credential) private credentials;

    event CredentialIssued(bytes32 indexed credentialId, address indexed subject, address indexed issuer);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed actor);

    function issueCredential(bytes32 credentialId, address subject, uint64 expiresAt) external {
        // INTENTIONALLY VULNERABLE: no issuer authorization or input validation.
        credentials[credentialId] = Credential(subject, msg.sender, expiresAt, false, true);
        emit CredentialIssued(credentialId, subject, msg.sender);
    }

    function revokeCredential(bytes32 credentialId) external {
        // INTENTIONALLY VULNERABLE: any caller can revoke any credential.
        require(credentials[credentialId].exists, "Credential does not exist");
        credentials[credentialId].revoked = true;
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