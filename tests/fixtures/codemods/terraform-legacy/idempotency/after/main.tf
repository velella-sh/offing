terraform {
  required_version = ">= 1.5.0"
}

locals {
  name  = var.name
  ports = tolist([80, 443])
}
