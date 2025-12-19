API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. ifconfig:: have_doxygen

   .. doxygenfile:: configuration.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: deviceTree.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: extension.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: hostEndpoints.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: logPanel.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: logSession.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: passwordManager.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sshCommandRunner.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sshTerminal.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: ssh2.d.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: loggerPanel.js
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sidebarView.js
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sftpExplorer.js
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sftpExplorer.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

   .. doxygenfile:: sidebarView.ts
      :project: VSCode-Logger
      :sections: func, var, define, enum, typedef, class

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
