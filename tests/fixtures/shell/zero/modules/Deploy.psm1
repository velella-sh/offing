#Requires -Version 7.6

function Get-DeployTarget {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )
    $Name
}

Export-ModuleMember -Function Get-DeployTarget
