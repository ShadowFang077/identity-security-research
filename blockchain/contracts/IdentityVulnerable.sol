// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Intentionally insecure teaching contract. Never deploy to a public network.
contract IdentityVulnerable {
    struct Identity {
        string displayName;
        bytes32 commitment;
        bool exists;
    }

    mapping(address => Identity) private identities;

    event IdentityRegistered(address indexed subject);
    event IdentityUpdated(address indexed subject, address indexed actor);
    event IdentityDeleted(address indexed subject, address indexed actor);

    function registerIdentity(string calldata displayName, bytes32 commitment) external {
        // INTENTIONALLY VULNERABLE: empty data and duplicate registration are accepted.
        identities[msg.sender] = Identity(displayName, commitment, true);
        emit IdentityRegistered(msg.sender);
    }

    function updateIdentity(
        address subject,
        string calldata displayName,
        bytes32 commitment
    ) external {
        // INTENTIONALLY VULNERABLE: any caller can alter another subject's identity.
        require(identities[subject].exists, "Identity does not exist");
        identities[subject].displayName = displayName;
        identities[subject].commitment = commitment;
        emit IdentityUpdated(subject, msg.sender);
    }

    function deleteIdentity(address subject) external {
        // INTENTIONALLY VULNERABLE: any caller can delete another subject's identity.
        require(identities[subject].exists, "Identity does not exist");
        delete identities[subject];
        emit IdentityDeleted(subject, msg.sender);
    }

    function getIdentity(address subject)
        external
        view
        returns (string memory displayName, bytes32 commitment, bool exists)
    {
        Identity storage identity = identities[subject];
        return (identity.displayName, identity.commitment, identity.exists);
    }

    function verifyIdentity(address subject) external view returns (bool) {
        return identities[subject].exists;
    }
}