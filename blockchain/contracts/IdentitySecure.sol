// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Stores synthetic identity labels and commitments, never personal data.
contract IdentitySecure {
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
        require(!identities[msg.sender].exists, "Identity already exists");
        _validate(displayName, commitment);

        identities[msg.sender] = Identity(displayName, commitment, true);
        emit IdentityRegistered(msg.sender);
    }

    function updateIdentity(
        address subject,
        string calldata displayName,
        bytes32 commitment
    ) external {
        require(subject == msg.sender, "Not identity owner");
        require(identities[subject].exists, "Identity does not exist");
        _validate(displayName, commitment);

        identities[subject].displayName = displayName;
        identities[subject].commitment = commitment;
        emit IdentityUpdated(subject, msg.sender);
    }

    function deleteIdentity(address subject) external {
        require(subject == msg.sender, "Not identity owner");
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

    function _validate(string calldata displayName, bytes32 commitment) private pure {
        uint256 nameLength = bytes(displayName).length;
        require(nameLength > 0 && nameLength <= 64, "Invalid display name");
        require(commitment != bytes32(0), "Invalid commitment");
    }
}