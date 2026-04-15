# gitsema

![Gitsema logo](assets/logo.png)

[![npm version](https://img.shields.io/npm/v/gitsema.svg)](https://www.npmjs.com/package/gitsema) [![CI](https://github.com/jsilvanus/gitsema/actions/workflows/ci.yml/badge.svg)](https://github.com/jsilvanus/gitsema/actions/workflows/ci.yml)

A content-addressed semantic index synchronized with Git's object model.

Gitsema walks your Git history, embeds every blob, and lets you semantically search your codebase — including across time. It treats blob hashes as the unit of identity, so identical content is only embedded once regardless of how many commits reference it.
