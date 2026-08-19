#---------------------------------------------------------------------------------------------------------------------
# Butano project makefile, following the layout Butano's own template uses.
#
# Paths here are relative, exactly as Butano requires — it prefixes them with
# the project directory, so an absolute path silently resolves to nothing. The
# builder therefore compiles inside /opt/butano/work/<name>, which is the same
# two-levels-down position Butano's own examples build from.
#---------------------------------------------------------------------------------------------------------------------
ifeq ($(strip $(DEVKITARM)),)
$(error "Set DEVKITARM in your environment: export DEVKITARM=<path to>devkitARM")
endif

TARGET      :=  $(notdir $(CURDIR))
BUILD       :=  build
LIBBUTANO   :=  ../../butano
PYTHON      :=  python3
SOURCES     :=  src ../../common/src
INCLUDES    :=  include ../../common/include
DATA        :=
# common/graphics is not optional: the bundled font header pulls in a sprite
# item that Butano's asset pipeline generates from this directory.
GRAPHICS    :=  graphics ../../common/graphics
AUDIO       :=
DMGAUDIO    :=
ROMTITLE    :=  POPLUR GAME
ROMCODE     :=  PGME
USERFLAGS   :=
USERASFLAGS :=
USERLDFLAGS :=
USERLIBDIRS :=
USERLIBS    :=
DEFAULTLIBS :=
STACKTRACE  :=
USERBUILD   :=
EXTTOOL     :=

#---------------------------------------------------------------------------------------------------------------------
# Butano resolves its own includes through this absolute path, so it must be
# exported before butano.mak is included.
#---------------------------------------------------------------------------------------------------------------------
ifndef LIBBUTANOABS
	export LIBBUTANOABS	:=	$(realpath $(LIBBUTANO))
endif

include $(LIBBUTANOABS)/butano.mak
